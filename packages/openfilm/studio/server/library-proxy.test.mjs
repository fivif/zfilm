import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { get } from 'node:http';

/* a home of the tests' own: the proxy is kept in the Studio home, not in a project */
before(() => {
  process.env.OPENFILM_HOME = mkdtempSync(join(tmpdir(), 'proxy-home-'));
});

const { proxyProblem, savedProxy, saveProxy, proxyFile, forgetProxy, hasProxyFile, proxyAgent } = await import('./library-proxy.mjs');

test('a proxy name is http, https or socks with a host and a port; empty means direct, which is no error', () => {
  for (const ok of ['http://127.0.0.1:10808', 'https://proxy.example.com:8443', 'socks5://127.0.0.1:1080', 'socks5h://10.0.0.2:1080', 'socks4://h:1',
    'http://user:pass@127.0.0.1:3128', '  http://127.0.0.1:8080/  ', '']) {
    assert.equal(proxyProblem(ok), null, ok);
  }
  for (const bad of ['127.0.0.1:10808', 'http://127.0.0.1', 'ftp://h:21', 'http://h:0', 'http://h:70000', 'just words', 'http://h:1//x']) {
    assert.notEqual(proxyProblem(bad), null, bad);
  }
  assert.notEqual(proxyProblem(42), null);
});

test('one is saved in the Studio home, readable by its user alone, and read back as it was written', () => {
  assert.equal(hasProxyFile(), false);
  assert.equal(savedProxy(), '', 'nothing saved: direct');
  assert.equal(saveProxy('socks5://127.0.0.1:1080'), 'socks5://127.0.0.1:1080');
  forgetProxy();
  assert.equal(savedProxy(), 'socks5://127.0.0.1:1080', 'the next look reads the file, not what was in memory');
  const mode = statSync(proxyFile()).mode & 0o777;
  assert.ok(mode === 0o600 || process.platform === 'win32', `mode ${mode.toString(8)}`);
  assert.deepEqual(JSON.parse(readFileSync(proxyFile(), 'utf8')), { version: 1, proxy: 'socks5://127.0.0.1:1080' });
});

test('a bad name is refused and the one saved stays; an empty one means direct again', () => {
  assert.throws(() => saveProxy('127.0.0.1:1080'), /http:\/\/host:port or socks5:\/\/host:port/);
  forgetProxy();
  assert.equal(savedProxy(), 'socks5://127.0.0.1:1080', 'the bad save changed nothing');
  assert.equal(saveProxy(''), '');
  forgetProxy();
  assert.equal(savedProxy(), '');
  assert.equal(hasProxyFile(), false, 'cleared: the file is gone');
});

test('socks5 and socks5h send an unresolved destination name to the proxy and preserve authentication', { timeout: 10_000 }, async (t) => {
  /* This proxy deliberately does not resolve or connect to the target. A local DNS lookup of .invalid fails,
     so receiving a domain-name CONNECT and the HTTP body proves DNS was delegated to the proxy. */
  const seen = [];
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let pending = Buffer.alloc(0);
    let phase = 'greeting';
    const request = {};
    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      for (;;) {
        if (phase === 'greeting') {
          if (pending.length < 2 || pending.length < 2 + pending[1]) return;
          assert.equal(pending[0], 5);
          assert.ok(pending.subarray(2, 2 + pending[1]).includes(2), 'username/password authentication is offered');
          pending = pending.subarray(2 + pending[1]);
          socket.write(Buffer.from([5, 2]));
          phase = 'auth';
        } else if (phase === 'auth') {
          if (pending.length < 2) return;
          const userBytes = pending[1];
          if (pending.length < 3 + userBytes) return;
          const passwordBytes = pending[2 + userBytes];
          if (pending.length < 3 + userBytes + passwordBytes) return;
          assert.equal(pending[0], 1);
          request.user = pending.subarray(2, 2 + userBytes).toString();
          request.password = pending.subarray(3 + userBytes, 3 + userBytes + passwordBytes).toString();
          pending = pending.subarray(3 + userBytes + passwordBytes);
          socket.write(Buffer.from([1, 0]));
          phase = 'connect';
        } else if (phase === 'connect') {
          if (pending.length < 5) return;
          assert.deepEqual([...pending.subarray(0, 4)], [5, 1, 0, 3], 'SOCKS CONNECT uses domain ATYP, never an IP resolved locally');
          const nameBytes = pending[4];
          if (pending.length < 7 + nameBytes) return;
          request.host = pending.subarray(5, 5 + nameBytes).toString();
          request.port = pending.readUInt16BE(5 + nameBytes);
          pending = pending.subarray(7 + nameBytes);
          socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80]));
          phase = 'http';
        } else {
          if (!pending.includes('\r\n\r\n')) return;
          request.http = pending.toString();
          seen.push(request);
          socket.end('HTTP/1.1 200 OK\r\nContent-Length: 15\r\nConnection: close\r\n\r\nremote-dns-body');
          return;
        }
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    saveProxy('');
    forgetProxy();
  });
  const port = server.address().port;
  for (const protocol of ['socks5', 'socks5h']) {
    saveProxy(`${protocol}://user%40name:p%3Ass@127.0.0.1:${port}`);
    const agent = await proxyAgent();
    try {
      const body = await new Promise((resolve, reject) => {
        const req = get('http://library-dns-regression.invalid:8123/audio/test.mp3', { agent }, (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => { text += chunk; });
          res.on('end', () => resolve(text));
          res.on('error', reject);
        });
        req.setTimeout(2_000, () => req.destroy(new Error('test proxy timed out')));
        req.on('error', reject);
      });
      assert.equal(body, 'remote-dns-body');
    } finally { agent.destroy(); }
  }
  assert.equal(seen.length, 2);
  for (const request of seen) {
    assert.equal(request.host, 'library-dns-regression.invalid');
    assert.equal(request.port, 8123);
    assert.equal(request.user, 'user@name');
    assert.equal(request.password, 'p:ss');
    assert.match(request.http, /^GET \/audio\/test\.mp3 HTTP\/1\.1/);
  }
});
