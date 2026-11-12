import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createMediaAnalyzer, readMediaAnalysis } from './library-agent-analysis.mjs';
import { createLibraryImportService } from './library-import-service.mjs';

const run = promisify(execFile);
const ffmpeg = process.env.ZFILM_TEST_FFMPEG || 'ffmpeg';
const ffprobe = process.env.ZFILM_TEST_FFPROBE || 'ffprobe';
const result = { title: '红色画面', description: '纯红色短片，可作为背景。', tags: ['红色', '背景'], suggestedUses: ['背景'] };

test('invalid and incomplete agent responses fail rather than fabricating analysis', () => {
  assert.throws(() => readMediaAnalysis('done'), /valid media analysis JSON/);
  assert.throws(() => readMediaAnalysis('{"title":"x"}'), /title, description and tags/);
  assert.deepEqual(readMediaAnalysis('```json\n' + JSON.stringify(result) + '\n```'), result);
  const beforeTrailer = JSON.stringify(result).slice(0, -1);
  assert.deepEqual(readMediaAnalysis(`${beforeTrailer}, "z_end_turn_review": "`), result);
  assert.deepEqual(readMediaAnalysis(`${beforeTrailer}, "z_end_turn_review": "transport trailer removed`), result);
  assert.throws(() => readMediaAnalysis('{"title":"x","description":"cut off'), /valid media analysis JSON/);
  assert.throws(() => readMediaAnalysis('{"title":"x","description":"x","tags":["x"],"z_end_turn_review":"'), /valid media analysis JSON/);
  assert.throws(() => readMediaAnalysis(`${beforeTrailer}, "other": "incomplete`), /valid media analysis JSON/);
});

test('real media copies reach the captured agent with actual frames, streaming logs, and failed-only retry', async t => {
  try { await run(ffmpeg, ['-version'], { windowsHide: true }); } catch { return t.skip('ffmpeg is not installed'); }
  const root = await mkdtemp(join(tmpdir(), 'zfilm-analyze-'));
  const source = join(root, 'input');
  await mkdir(source);
  await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x48:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(source, 'red.mp4')], { windowsHide: true });
  const before = await readFile(join(source, 'red.mp4'));
  const snapshots = [];
  let attempt = 0;
  const analyzer = createMediaAnalyzer({ ffmpeg, ffprobe, ask: async (agent, prompt, signal, options, images, observer) => {
    snapshots.push({ agent, options });
    assert.equal(agent, 'codex');
    assert.equal(options.model, 'captured-model');
    assert.equal(images.length, 3);
    assert.ok(images.every(image => Buffer.from(image.data, 'base64').subarray(0, 2).equals(Buffer.from([255, 216]))));
    assert.match(prompt, /Technical metadata/);
    assert.ok(!prompt.includes(source), 'no original absolute directory enters the prompt');
    assert.equal(signal.aborted, false);
    observer.onText('Analyzing sampled frames.\n');
    return ++attempt === 1 ? 'invalid response' : JSON.stringify(result);
  } });
  const service = createLibraryImportService({ storageRoot: join(root, 'jobs'), libraryRoot: join(root, 'saved'), runAgent: analyzer });
  const waitFor = async id => {
    for (let i = 0; i < 300; i++) {
      const job = await service.getJob(id);
      if (['failed', 'succeeded'].includes(job.status)) return job;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Import did not finish');
  };
  try {
    const job = await service.create({ sourceRoot: source, snapshot: { agent: 'codex', options: { model: 'captured-model', thought_level: 'high' } } });
    const failed = await waitFor(job.id);
    assert.equal(failed.status, 'failed');
    assert.match(failed.items[0].error, /valid media analysis JSON/);
    assert.ok(failed.logs.some(log => log.message.includes('Analyzing sampled frames')));
    const managed = failed.items[0].managedPath;
    await service.retryFailed(job.id);
    const done = await waitFor(job.id);
    assert.equal(done.status, 'succeeded');
    assert.equal(done.items[0].managedPath, managed);
    assert.equal(done.items[0].metadata.title, result.title);
    assert.equal(done.items[0].metadata.evidence, 'sampled-frames');
    assert.deepEqual(snapshots[0], snapshots[1]);
    assert.deepEqual(await readFile(join(source, 'red.mp4')), before);
    assert.deepEqual(await readFile(managed), before);
  } finally { await service.close(); await rm(root, { recursive: true, force: true }); }
});

test('actual static JPEG and PNG produce reference bytes instead of successful empty ffmpeg output', async t => {
  try { await run(ffmpeg, ['-version'], { windowsHide: true }); } catch { return t.skip('ffmpeg is not installed'); }
  const root = await mkdtemp(join(tmpdir(), 'zfilm-still-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const snapshot = { agent: 'codex', options: { model: 'captured-model', reasoning_effort: 'high', 'fast-mode': 'on' } };
  const calls = [];
  const analyzer = createMediaAnalyzer({ ffmpeg, ffprobe, ask: async (agent, prompt, signal, options, images) => {
    assert.equal(agent, snapshot.agent);
    assert.deepEqual(options, snapshot.options);
    assert.equal(images.length, 1);
    const bytes = Buffer.from(images[0].data, 'base64');
    assert.ok(bytes.length > 100);
    assert.deepEqual([...bytes.subarray(0, 2)], [255, 216]);
    calls.push(images[0]);
    return JSON.stringify(result);
  } });
  for (const extension of ['jpg', 'png']) {
    const managedPath = join(root, `中文 首帧.${extension}`);
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=128x72', '-frames:v', '1', managedPath], { windowsHide: true });
    const before = await readFile(managedPath);
    const metadata = await analyzer({ snapshot, managedPath, relativePath: `nested/中文 首帧.${extension}`, signal: new AbortController().signal }, () => {});
    assert.equal(metadata.evidence, 'sampled-frames');
    assert.deepEqual(await readFile(managedPath), before);
  }
  assert.equal(calls.length, 2);
});

test('Markdown, JavaScript and SVG reach the selected agent as text without executing or rendering', async t => {
  const root = await mkdtemp(join(tmpdir(), 'zfilm-text-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const marker = join(root, 'must-not-exist');
  const source = `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed');`;
  const contents = { '风格.md': '# 字雨动画\n使用等宽字体、逐字淡入。', 'animation.js': source, 'reference.svg': '<svg><text>字雨</text></svg>' };
  const snapshot = { agent: 'codex', options: { model: 'captured-model', reasoning_effort: 'high', 'fast-mode': 'on' } };
  for (const [relativePath, content] of Object.entries(contents)) {
    const managedPath = join(root, relativePath);
    await writeFile(managedPath, content);
    const logs = [];
    const analyzer = createMediaAnalyzer({ executeFile: async () => { throw new Error('Text must not invoke ffmpeg or execute code'); }, ask: async (agent, prompt, signal, options, images) => {
      assert.equal(agent, snapshot.agent);
      assert.deepEqual(options, snapshot.options);
      assert.equal(images.length, 0);
      assert.ok(prompt.includes(content));
      assert.match(prompt, /untrusted data/);
      assert.match(prompt, /no code was executed/);
      assert.match(prompt, /no HTML or SVG was rendered/);
      assert.ok(!prompt.includes(root) || relativePath.endsWith('.js'), 'original directories are absent except literal source-code data');
      return JSON.stringify(result);
    } });
    const metadata = await analyzer({ snapshot, managedPath, relativePath, signal: new AbortController().signal }, text => logs.push(text));
    assert.equal(metadata.evidence, 'text-content');
    assert.equal(metadata.technical.truncated, false);
    assert.equal(await readFile(managedPath, 'utf8'), content);
    assert.ok(logs.some(row => row.includes('Reading text')));
  }
  await assert.rejects(access(marker), { code: 'ENOENT' });
});

test('text previews handle UTF-16, bound large UTF-8 at multibyte boundaries, and reject binary input', async t => {
  const root = await mkdtemp(join(tmpdir(), 'zfilm-text-bounds-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const snapshot = { agent: 'codex', options: {} };
  const prompts = [];
  const analyzer = createMediaAnalyzer({ executeFile: async () => { throw new Error('No media command for text'); }, ask: async (_agent, prompt) => { prompts.push(prompt); return JSON.stringify(result); } });
  const runText = async (name, bytes) => {
    const managedPath = join(root, name);
    await writeFile(managedPath, bytes);
    return analyzer({ snapshot, managedPath, relativePath: name, signal: new AbortController().signal }, () => {});
  };
  const utf16 = await runText('utf16.md', Buffer.concat([Buffer.from([255, 254]), Buffer.from('# 中文风格', 'utf16le')]));
  assert.equal(utf16.technical.encoding, 'utf-16le');
  assert.match(prompts[0], /# 中文风格/);
  const large = await runText('large.md', 'A'.repeat(65535) + '汉字TAIL');
  assert.equal(large.technical.previewBytes, 65536);
  assert.equal(large.technical.truncated, true);
  assert.ok(!prompts.at(-1).includes('TAIL'));
  assert.ok(!prompts.at(-1).includes('\ufffd'));
  assert.match(prompts.at(-1), /analysis covers only the preview/);
  await assert.rejects(runText('binary.js', Buffer.from([65, 0, 66])), /binary data/);
  await assert.rejects(runText('bad.md', Buffer.from([255, 0, 255])), /not valid UTF/);
  assert.equal(prompts.length, 2);
});
