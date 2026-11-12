import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* a library of the tests' own: two sounds, one music, one cover, one emoji sticker, and a host that serves them */
const root = mkdtempSync(join(tmpdir(), 'sync-builtin-'));
const cache = mkdtempSync(join(tmpdir(), 'sync-cache-'));
const sounds = [
  { id: 'audio/sfx/one.mp3', cat: 'sound', cover: 'audio/covers/a.jpg' },
  { id: 'audio/sfx/two.mp3', cat: 'sound', cover: 'audio/covers/a.jpg' },
  { id: 'audio/music/three.mp3', cat: 'music', cover: 'audio/covers/b.jpg' },
];
writeFileSync(join(root, 'audio.json'), JSON.stringify({ version: 1, groups: {}, items: sounds }));
writeFileSync(join(root, 'stickers.json'), JSON.stringify({ version: 1, groups: {}, items: [{ id: 'stickers/emoji/wave', cat: 'sticker' }] }));

/** What the host says each path is: a body of that many bytes; the sticker is a bundle with a list of its files. */
const bodies = new Map([
  ['audio/sfx/one.mp3', 'x'.repeat(11)],
  ['audio/sfx/two.mp3', 'x'.repeat(22)],
  ['audio/music/three.mp3', 'x'.repeat(33)],
  ['audio/covers/a.jpg', 'x'.repeat(5)],
  ['audio/covers/b.jpg', 'x'.repeat(6)],
  ['stickers/emoji/wave/emoji.html', 'x'.repeat(7)],
]);
const asked = [];
let bundleFiles = ['emoji.html'];
let failBundleChild = false;
const host = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '').replace(/^\//, ''));
  asked.push(path);
  if (path === 'stickers/emoji/wave/files.json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(bundleFiles));
  }
  if (path === 'stickers/emoji/wave/texture.png' && failBundleChild) {
    res.writeHead(503);
    return res.end('temporary failure');
  }
  const body = bodies.get(path);
  if (body === undefined) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': Buffer.byteLength(body) });
  res.end(body);
});

before(async () => {
  await new Promise((done) => host.listen(0, '127.0.0.1', () => done(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (host.address()).port;
  process.env.OPENFILM_BUILT_IN_LIBRARY = root;
  process.env.OPENFILM_LIBRARY_CACHE = cache;
  process.env.OPENFILM_LIBRARY_URL = `http://127.0.0.1:${port}`;
});
after(() => host.close());

const { plan, status, start, pause, clear, whenIdle, forget } = await import('./library-sync.mjs');

test('the parts are worked out from the catalogs in the package: each sound, each piece of music, each cover once, each sticker as a bundle', async () => {
  forget();
  const parts = plan();
  assert.deepEqual(parts.map((p) => p.id), ['music', 'sfx', 'covers', 'stickers']);
  const sfx = parts.find((p) => p.id === 'sfx');
  assert.deepEqual(sfx?.files, ['audio/sfx/one.mp3', 'audio/sfx/two.mp3']);
  assert.deepEqual(parts.find((p) => p.id === 'covers')?.files, ['audio/covers/a.jpg', 'audio/covers/b.jpg'], 'a cover two sounds share is fetched once');
  assert.deepEqual(parts.find((p) => p.id === 'stickers')?.bundles, ['stickers/emoji/wave']);
});

test('nothing is here at first: one part at a time, its files counted and its size learned from what arrives', async () => {
  forget();
  let now = status();
  assert.deepEqual(now.parts.find((p) => p.id === 'sfx'), { id: 'sfx', files: 2, done: 0, bytes: 0 });
  assert.equal(now.running, null);

  start(['sfx']);
  await whenIdle();
  now = status();
  assert.deepEqual(now.parts.find((p) => p.id === 'sfx'), { id: 'sfx', files: 2, done: 2, bytes: 33 }, '11 + 22 bytes');
  assert.equal(readFileSync(join(cache, 'audio/sfx/two.mp3'), 'utf8').length, 22);

  start(['covers', 'stickers']);
  await whenIdle();
  now = status();
  assert.equal(now.parts.find((p) => p.id === 'covers')?.done, 2);
  assert.equal(now.parts.find((p) => p.id === 'stickers')?.done, 1, 'a bundle counts as one, fetched from its files.json');
  assert.ok(existsSync(join(cache, 'stickers/emoji/wave/emoji.html')));
});

test('a second run fetches nothing again: what is here is skipped, so it is safe to press twice', async () => {
  forget();
  const before = asked.length;
  start();
  await whenIdle();
  const again = asked.slice(before);
  assert.deepEqual(again.filter((p) => p.startsWith('audio/sfx/')), [], 'the sounds already here are not asked for again');
  assert.equal(status().parts.find((p) => p.id === 'sfx')?.done, 2);
});

test('pause lets the files in flight finish, and a later start goes on from what is there', async () => {
  forget();
  clear(['music']);
  assert.equal(status().parts.find((p) => p.id === 'music')?.done, 0, 'cleared: the music is gone again');
  const paused = pause();
  assert.equal(paused.running, null, 'nothing was running, so nothing to stop');
  start(['music']);
  await whenIdle();
  assert.deepEqual(status().parts.find((p) => p.id === 'music'), { id: 'music', files: 1, done: 1, bytes: 33 });
});

test('clearing takes away only what was fetched, and only the parts asked for', async () => {
  clear(['sfx']);
  assert.equal(existsSync(join(cache, 'audio/sfx/one.mp3')), false);
  assert.ok(existsSync(join(cache, 'audio/music/three.mp3')), 'the music was not asked about and stays');
  const now = status();
  assert.equal(now.parts.find((p) => p.id === 'sfx')?.done, 0);
  assert.deepEqual(now.parts.find((p) => p.id === 'music')?.done, 1);
});

test('a partial bundle exhausts retries as a failure, then resumes only its missing children', { timeout: 15_000 }, async () => {
  forget();
  clear(['stickers']);
  bundleFiles = ['emoji.html', 'texture.png'];
  bodies.set('stickers/emoji/wave/texture.png', 'texture-body');
  failBundleChild = true;
  const before = asked.length;
  try {
    start(['stickers']);
    await whenIdle();
    const failedRequests = asked.slice(before);
    assert.equal(failedRequests.filter((path) => path.endsWith('/texture.png')).length, 3, 'the incomplete bundle is retried to exhaustion');
    assert.equal(failedRequests.filter((path) => path.endsWith('/emoji.html')).length, 1, 'successful children survive the internal retries');
    assert.equal(failedRequests.filter((path) => path.endsWith('/files.json')).length, 3);
    const failed = status();
    assert.equal(failed.running, null);
    assert.equal(failed.parts.find((part) => part.id === 'stickers')?.done, 0);
    assert.deepEqual(failed.failures.map((failure) => failure.path), ['stickers/emoji/wave']);
    assert.match(failed.failures[0].error, /texture\.png.*503/);
    assert.ok(existsSync(join(cache, 'stickers/emoji/wave/.partial')), 'the bundle remains visibly incomplete after exhaustion');
    assert.equal(readFileSync(join(cache, 'stickers/emoji/wave/emoji.html'), 'utf8'), 'x'.repeat(7));
    assert.equal(existsSync(join(cache, 'stickers/emoji/wave/texture.png')), false);

    failBundleChild = false;
    const retryStart = asked.length;
    start(['stickers']);
    await whenIdle();
    const resumed = asked.slice(retryStart);
    assert.deepEqual(resumed, ['stickers/emoji/wave/files.json', 'stickers/emoji/wave/texture.png'], 'retry downloads only the missing file, not the complete child');
    assert.equal(existsSync(join(cache, 'stickers/emoji/wave/.partial')), false, 'only the completed bundle loses its marker');
    assert.equal(readFileSync(join(cache, 'stickers/emoji/wave/texture.png'), 'utf8'), 'texture-body');
    assert.equal(status().parts.find((part) => part.id === 'stickers')?.done, 1);
    assert.deepEqual(status().failures, []);
    const complete = asked.length;
    start(['stickers']);
    await whenIdle();
    assert.equal(asked.length, complete, 'a completed bundle is skipped entirely');
  } finally {
    bundleFiles = ['emoji.html'];
    failBundleChild = false;
  }
});
