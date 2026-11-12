import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLibraryImportService } from './library-import-service.mjs';
import { classifyImportFile, isImportFile } from './library-import-formats.mjs';

async function fixture(t, runAgent, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'zfilm-import-'));
  const sourceRoot = join(root, 'source');
  const storageRoot = join(root, 'jobs');
  const libraryRoot = join(root, 'saved');
  await mkdir(sourceRoot, { recursive: true });
  const services = [];
  const make = (run = runAgent) => {
    const service = createLibraryImportService({ storageRoot, libraryRoot, runAgent: run, ...extra });
    services.push(service); return service;
  };
  t.after(async () => { for (const service of services) await service.close(); await rm(root, { recursive: true, force: true }); });
  return { root, sourceRoot, storageRoot, libraryRoot, make };
}
const picked = () => ({ agent: 'codex', options: { model: 'model-a', thought_level: 'high' } });
async function finished(service, id) {
  for (let n = 0; n < 500; n++) {
    const job = await service.getJob(id);
    if (['succeeded', 'failed'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Import did not finish');
}

test('nested media are copied into Saved, processed with frozen selection, and emit progress', async t => {
  const calls = [];
  const f = await fixture(t, async (request, onLog) => {
    calls.push(request);
    onLog('Inspecting the managed copy');
    assert.equal(await readFile(request.managedPath, 'utf8'), 'original');
    return { title: request.relativePath, tags: ['test'] };
  });
  await mkdir(join(f.sourceRoot, 'nested'));
  await writeFile(join(f.sourceRoot, 'nested', 'image.png'), 'original');
  await writeFile(join(f.sourceRoot, 'note.bin'), 'unsupported');
  const events = [];
  const service = f.make();
  const unsubscribe = service.subscribe(event => events.push(event));
  const snapshot = picked();
  const created = await service.create({ sourceRoot: f.sourceRoot, snapshot });
  snapshot.options.model = 'changed-after-import';
  const done = await finished(service, created.id);
  assert.equal(done.status, 'succeeded');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].snapshot, picked());
  assert.equal(calls[0].relativePath, 'nested/image.png');
  assert.ok(calls[0].managedPath.startsWith(f.libraryRoot));
  assert.equal(await readFile(join(f.sourceRoot, 'nested', 'image.png'), 'utf8'), 'original');
  assert.equal(done.items.find(item => item.relativePath === 'note.bin').status, 'skipped');
  const image = done.items.find(item => item.relativePath.endsWith('image.png'));
  assert.equal(image.status, 'succeeded');
  assert.ok(image.libraryPath.startsWith('saved/'));
  const metadata = JSON.parse(await readFile(join(done.destination, '.zfilm-ai', 'nested', 'image.png.json'), 'utf8'));
  assert.deepEqual(metadata.metadata.tags, ['test']);
  assert.ok(events.some(event => event.job.status === 'running'));
  assert.ok(events.some(event => event.job.logs.some(log => log.message === 'Inspecting the managed copy')));
  assert.equal(new Set(done.logs.map(log => log.seq)).size, done.logs.length);
  unsubscribe();
});

test('retry only processes failed items and keeps their original managed copies and agent snapshot', async t => {
  const calls = new Map();
  const f = await fixture(t, async request => {
    calls.set(request.relativePath, (calls.get(request.relativePath) || 0) + 1);
    if (request.relativePath === 'b.mp4' && calls.get('b.mp4') === 1) throw new Error('temporary agent outage');
    assert.deepEqual(request.snapshot, picked());
    return { contents: await readFile(request.managedPath, 'utf8') };
  });
  await writeFile(join(f.sourceRoot, 'a.png'), 'a');
  await writeFile(join(f.sourceRoot, 'b.mp4'), 'b-original');
  const service = f.make();
  const created = await service.create({ sourceRoot: f.sourceRoot, snapshot: picked() });
  const first = await finished(service, created.id);
  assert.equal(first.status, 'failed');
  assert.match(first.items.find(item => item.relativePath === 'b.mp4').error, /temporary agent outage/);
  await writeFile(join(f.sourceRoot, 'b.mp4'), 'modified-source');
  await service.retryFailed(created.id);
  const second = await finished(service, created.id);
  assert.equal(second.status, 'succeeded');
  assert.equal(calls.get('a.png'), 1);
  assert.equal(calls.get('b.mp4'), 2);
  assert.equal(second.items.find(item => item.relativePath === 'b.mp4').metadata.contents, 'b-original');
  assert.ok(second.logs.some(log => /Retrying failed imports/.test(log.message)));
});

test('interrupted jobs recover as retryable failures without dispatching agent automatically', async t => {
  const f = await fixture(t, async () => ({ ready: true }));
  await writeFile(join(f.sourceRoot, 'a.png'), 'a');
  await writeFile(join(f.sourceRoot, 'b.wav'), 'b');
  const firstService = f.make();
  const created = await firstService.create({ sourceRoot: f.sourceRoot, snapshot: picked() });
  const done = await finished(firstService, created.id);
  await firstService.close();
  done.status = 'running';
  done.items.find(item => item.relativePath === 'b.wav').status = 'running';
  await writeFile(join(f.storageRoot, `${done.id}.json`), JSON.stringify(done));
  const calls = [];
  const recovered = f.make(async request => { calls.push(request.relativePath); return { recovered: true }; });
  const jobs = await recovered.listJobs();
  assert.equal(jobs[0].status, 'failed');
  assert.match(jobs[0].error, /interrupted/);
  assert.deepEqual(calls, []);
  assert.equal(jobs[0].items.find(item => item.relativePath === 'a.png').status, 'succeeded');
  await recovered.retryFailed(done.id);
  assert.equal((await finished(recovered, done.id)).status, 'succeeded');
  assert.deepEqual(calls, ['b.wav']);
});

test('unavailable agent rejects before creating files and never silently switches agent', async t => {
  const f = await fixture(t, async () => assert.fail('must not dispatch'), { validateAgent: async snapshot => { assert.equal(snapshot.agent, 'codex'); throw new Error('Codex is disconnected'); } });
  await writeFile(join(f.sourceRoot, 'image.png'), 'image');
  const service = f.make();
  await assert.rejects(service.create({ sourceRoot: f.sourceRoot, snapshot: picked() }), /disconnected/);
  assert.deepEqual(await service.listJobs(), []);
  assert.deepEqual(await readdir(f.libraryRoot), []);
});

test('a hard shutdown during copy resumes successfully despite a stale unpublished partial file', async t => {
  const f = await fixture(t, async () => ({ done: true }));
  await writeFile(join(f.sourceRoot, 'image.png'), 'complete-original');
  const service = f.make();
  const created = await service.create({ sourceRoot: f.sourceRoot, snapshot: picked() });
  const done = await finished(service, created.id);
  await service.close();
  done.status = 'running';
  done.items[0].status = 'running'; done.items[0].copied = false;
  await rm(done.items[0].managedPath);
  await writeFile(join(done.destination, `.image.png.${done.id}.partial`), 'interrupted');
  await writeFile(join(f.storageRoot, `${done.id}.json`), JSON.stringify(done));
  const recovered = f.make(async request => {
    assert.equal(await readFile(request.managedPath, 'utf8'), 'complete-original');
    return { done: true };
  });
  await recovered.retryFailed(done.id);
  assert.equal((await finished(recovered, done.id)).status, 'succeeded');
  assert.ok(!(await readdir(done.destination)).some(file => file.endsWith('.partial')));
});

test('empty folders report a real failure; managed library cannot recursively import itself', async t => {
  const f = await fixture(t, async () => assert.fail('must not dispatch'));
  const service = f.make();
  await assert.rejects(service.create({ sourceRoot: f.libraryRoot, snapshot: picked() }), /outside the managed/);
  const job = await service.create({ sourceRoot: f.sourceRoot, snapshot: picked() });
  const done = await finished(service, job.id);
  assert.equal(done.status, 'failed');
  assert.match(done.error, /No supported files/);
});

test('agent log history is bounded and remains ordered', async t => {
  const f = await fixture(t, async (_request, onLog) => {
    for (let i = 0; i < 750; i++) onLog(`chunk ${i}`);
    return { complete: true };
  });
  await writeFile(join(f.sourceRoot, 'image.png'), 'image');
  const service = f.make();
  const job = await service.create({ sourceRoot: f.sourceRoot, snapshot: picked() });
  const done = await finished(service, job.id);
  assert.equal(done.logs.length, 600);
  assert.ok(done.logs.every((log, i) => !i || log.seq > done.logs[i - 1].seq));
  assert.ok(done.logs.some(log => log.message === 'chunk 749'));
  await service.close();
  const recovered = f.make();
  const saved = await recovered.getJob(job.id);
  assert.deepEqual(saved.logs, done.logs);
});

test('live agent logs reach durable storage and closing aborts an active item', async t => {
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, async (request, onLog) => {
    onLog('Live processing checkpoint');
    entered();
    await new Promise((resolve, reject) => {
      if (request.signal.aborted) return reject(new Error('aborted'));
      request.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  });
  await writeFile(join(f.sourceRoot, 'image.png'), 'image');
  const service = f.make();
  const created = await service.create({ sourceRoot: f.sourceRoot, snapshot: picked() });
  await started;
  let persisted;
  for (let n = 0; n < 100; n++) {
    persisted = JSON.parse(await readFile(join(f.storageRoot, `${created.id}.json`), 'utf8'));
    if (persisted.logs.some(log => log.message === 'Live processing checkpoint')) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(persisted.logs.some(log => log.message === 'Live processing checkpoint'));
  assert.equal(persisted.status, 'running');
  await service.close();
  const failed = await service.getJob(created.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.items[0].status, 'failed');
  assert.equal(failed.items[0].copied, true);
});

test('style documents, source code and markup are copied and dispatched as material; unknown and hidden files stay excluded', async t => {
  const contents = new Map([
    ['style.MD', '# 字雨\n黑底，字母向下流动。'],
    ['animation.js', 'throw new Error("source must never be executed");'],
    ['_统计.json', '{"styles":1}'],
    ['layout.html', '<main>示例版式</main>'],
    ['logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"><text>Z</text></svg>'],
  ]);
  const calls = [];
  const f = await fixture(t, async request => {
    calls.push(request.relativePath);
    assert.equal(classifyImportFile(request.relativePath), 'text');
    assert.equal(await readFile(request.managedPath, 'utf8'), contents.get(request.relativePath));
    return { title: request.relativePath };
  });
  for (const [path, value] of contents) await writeFile(join(f.sourceRoot, path), value);
  await writeFile(join(f.sourceRoot, '.private.md'), 'hidden');
  await writeFile(join(f.sourceRoot, 'archive.zip'), 'unsupported');
  const service = f.make();
  const created = await service.create({ sourceRoot: f.sourceRoot, snapshot: picked() });
  const done = await finished(service, created.id);
  assert.equal(done.status, 'succeeded');
  assert.deepEqual([...calls].sort(), [...contents.keys()].sort());
  for (const [path, value] of contents) assert.equal(await readFile(join(f.sourceRoot, path), 'utf8'), value);
  assert.equal(done.items.find(item => item.relativePath === 'archive.zip').status, 'skipped');
  assert.ok(!done.items.some(item => item.relativePath === '.private.md'));
  assert.equal(done.retryableSkipped, 0);
  for (const extension of ['txt', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'css', 'py', 'csv']) assert.equal(classifyImportFile(`style.${extension}`), 'text');
  assert.equal(classifyImportFile('FRAME.JPG'), 'image');
  assert.equal(classifyImportFile('clip.mp4'), 'video');
  assert.equal(classifyImportFile('sound.wav'), 'audio');
  assert.equal(isImportFile('.env'), false);
  assert.equal(isImportFile('archive.zip'), false);
});

test('explicit retry upgrades persisted unsupported documents, retaining successes, managed copies, agent options and safety skips', async t => {
  const oldEligible = path => /\.(png|mp4)$/i.test(path);
  const f = await fixture(t, async request => {
    if (request.relativePath === 'failed.mp4') throw new Error('old image preparation failure');
    return { title: 'already complete' };
  }, { eligible: oldEligible });
  await writeFile(join(f.sourceRoot, 'complete.png'), 'complete-source');
  await writeFile(join(f.sourceRoot, 'failed.mp4'), 'original-copy');
  await writeFile(join(f.sourceRoot, 'style.md'), 'document');
  await writeFile(join(f.sourceRoot, 'script.js'), 'source code');
  await writeFile(join(f.sourceRoot, '_统计.json'), '{"styles":1}');
  await writeFile(join(f.sourceRoot, 'unsupported.zip'), 'not-importable');
  let deep = f.sourceRoot;
  for (let i = 0; i < 7; i++) deep = join(deep, String(i));
  await mkdir(join(deep, 'too-deep.md'), { recursive: true });
  await writeFile(join(deep, 'too-deep.md', 'nested.md'), 'too deep');
  const oldService = f.make();
  const selected = { agent: 'codex', options: { model: 'captured', reasoning_effort: 'high', 'fast-mode': 'on' } };
  const created = await oldService.create({ sourceRoot: f.sourceRoot, snapshot: selected });
  const old = await finished(oldService, created.id);
  assert.equal(old.status, 'failed');
  assert.equal(old.retryableSkipped, 0);
  await oldService.close();
  const successful = old.items.find(item => item.relativePath === 'complete.png');
  const failed = old.items.find(item => item.relativePath === 'failed.mp4');
  const safetySkip = old.items.find(item => item.relativePath.endsWith('too-deep.md'));
  assert.equal(safetySkip.skipReason, 'Folder is deeper than the media library supports.');
  // Old snapshots may contain symbolic-link skips whose extension is now supported.
  old.items.push({ ...old.items.find(item => item.relativePath === 'style.md'), id: 'legacy-link', relativePath: 'linked.md', skipReason: 'Symbolic links are skipped.' });
  await writeFile(join(f.storageRoot, `${old.id}.json`), JSON.stringify(old));
  await writeFile(join(f.sourceRoot, 'failed.mp4'), 'changed-after-copy');
  const calls = [];
  const upgraded = createLibraryImportService({
    storageRoot: f.storageRoot, libraryRoot: f.libraryRoot,
    runAgent: async request => {
      calls.push(request.relativePath);
      assert.deepEqual(request.snapshot, selected);
      return { title: request.relativePath, contents: await readFile(request.managedPath, 'utf8') };
    },
  });
  t.after(() => upgraded.close());
  const before = await upgraded.getJob(old.id);
  assert.equal(before.retryableSkipped, 3);
  assert.deepEqual(calls, [], 'opening old history must not start processing');
  const queued = await upgraded.retryFailed(old.id);
  assert.equal(queued.id, old.id);
  assert.equal(queued.retryableSkipped, 0);
  const done = await finished(upgraded, old.id);
  assert.equal(done.status, 'succeeded');
  assert.deepEqual([...calls].sort(), ['_统计.json', 'failed.mp4', 'script.js', 'style.md'].sort());
  assert.deepEqual(done.items.find(item => item.relativePath === 'complete.png'), successful);
  assert.equal(done.items.find(item => item.relativePath === 'failed.mp4').managedPath, failed.managedPath);
  assert.equal(done.items.find(item => item.relativePath === 'failed.mp4').metadata.contents, 'original-copy');
  assert.equal(done.items.find(item => item.relativePath === 'unsupported.zip').status, 'skipped');
  assert.equal(done.items.find(item => item.relativePath === safetySkip.relativePath).status, 'skipped');
  assert.equal(done.items.find(item => item.id === 'legacy-link').status, 'skipped');
  assert.ok(done.logs.some(log => /3 previously skipped file\(s\) now supported/.test(log.message)));
  await upgraded.close();
  const persisted = JSON.parse(await readFile(join(f.storageRoot, `${old.id}.json`), 'utf8'));
  assert.equal(persisted.status, 'succeeded');
  assert.deepEqual(persisted.snapshot, selected);
  assert.equal(persisted.items.find(item => item.relativePath === 'style.md').status, 'succeeded');
});

test('retry also imports newly supported documents from an otherwise succeeded legacy job', async t => {
  const f = await fixture(t, async () => ({ title: 'old result' }), { eligible: path => path.endsWith('.png') });
  await writeFile(join(f.sourceRoot, 'complete.png'), 'picture');
  await writeFile(join(f.sourceRoot, 'notes.md'), 'style description');
  await writeFile(join(f.sourceRoot, 'unknown.bin'), 'unknown');
  const oldService = f.make();
  const created = await oldService.create({ sourceRoot: f.sourceRoot, snapshot: picked() });
  const old = await finished(oldService, created.id);
  assert.equal(old.status, 'succeeded');
  await oldService.close();
  const calls = [];
  const upgraded = createLibraryImportService({ storageRoot: f.storageRoot, libraryRoot: f.libraryRoot, runAgent: async request => { calls.push(request.relativePath); return { title: 'document result' }; } });
  t.after(() => upgraded.close());
  assert.equal((await upgraded.listJobs())[0].retryableSkipped, 1);
  await upgraded.retryFailed(old.id);
  const done = await finished(upgraded, old.id);
  assert.equal(done.status, 'succeeded');
  assert.deepEqual(calls, ['notes.md']);
  assert.equal(done.items.find(item => item.relativePath === 'complete.png').attempt, 1);
  assert.equal(done.items.find(item => item.relativePath === 'notes.md').attempt, 1);
  assert.equal(done.items.find(item => item.relativePath === 'unknown.bin').status, 'skipped');
  assert.equal(done.retryableSkipped, 0);
  const noOp = await upgraded.retryFailed(old.id);
  assert.equal(noOp.seq, done.seq);
  assert.deepEqual(calls, ['notes.md']);
});
