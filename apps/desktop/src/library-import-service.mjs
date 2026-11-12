/** Durable, app-owned folder imports. Original files are never changed by the agent. */
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { classifyImportFile, isImportFile } from './library-import-formats.mjs';

const ACTIVE = new Set(['importing', 'queued', 'running']);
const MAX_LOGS = 600;
const clone = value => structuredClone(value);
const errorText = error => String(error?.message || error || 'Unknown error').slice(0, 4000);
const within = (root, path) => { const rel = relative(root, path); return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)); };
const now = () => new Date().toISOString();

/** Retained for callers that specifically need visual/audio media rather than source documents. */
export function isImportMedia(path) { return ['image', 'video', 'audio'].includes(classifyImportFile(path)); }

function selection(value) {
  if (!value || typeof value.agent !== 'string' || !value.agent.trim()) throw new Error('Select a connected agent before importing a folder.');
  const options = {};
  for (const [key, option] of Object.entries(value.options || {})) {
    if (typeof option === 'string' || typeof option === 'boolean' || (typeof option === 'number' && Number.isFinite(option))) options[key] = option;
  }
  return { agent: value.agent, options };
}

/**
 * runAgent receives only an app-managed copy and a frozen agent/model selection. It may return analysis metadata.
 * Every event is a complete job snapshot, so a renderer can subscribe before loading history without losing logs.
 */
export function createLibraryImportService({ storageRoot, libraryRoot, runAgent, validateAgent = async () => {}, eligible = isImportFile }) {
  if (typeof runAgent !== 'function') throw new TypeError('runAgent is required');
  storageRoot = resolve(storageRoot);
  libraryRoot = resolve(libraryRoot);
  const jobs = new Map();
  const listeners = new Set();
  const writes = new Map();
  const logTimers = new Map();
  const pending = [];
  let draining = false;
  let closed = false;
  let running = null;
  let drainPromise = Promise.resolve();
  const storeFile = id => join(storageRoot, `${id}.json`);
  const newlySupported = (job, item) => item.status === 'skipped'
    && item.skipReason === 'Unsupported file type.'
    && typeof item.relativePath === 'string'
    && !item.relativePath.split(/[\\/]/).some(part => part.startsWith('.'))
    && eligible(resolve(job.sourceRoot, item.relativePath));
  const publicJob = job => ({ ...clone(job), retryableSkipped: job.items.filter(item => newlySupported(job, item)).length });
  function emit(job) {
    const event = { type: 'job', jobId: job.id, seq: job.seq, job: publicJob(job) };
    for (const listener of listeners) { try { listener(clone(event)); } catch {} }
  }
  function log(job, message, itemId) {
    job.seq++;
    job.updatedAt = now();
    job.logs.push({ seq: job.seq, time: job.updatedAt, message: String(message).slice(0, 8000), ...(itemId ? { itemId } : {}) });
    if (job.logs.length > MAX_LOGS) job.logs.splice(0, job.logs.length - MAX_LOGS);
    emit(job);
  }
  async function save(job) {
    clearTimeout(logTimers.get(job.id));
    logTimers.delete(job.id);
    job.updatedAt = now();
    const content = JSON.stringify(job, null, 2);
    const previous = writes.get(job.id) || Promise.resolve();
    const write = previous.catch(() => {}).then(async () => {
      const tmp = `${storeFile(job.id)}.tmp`;
      await writeFile(tmp, content, 'utf8');
      await rename(tmp, storeFile(job.id));
    });
    writes.set(job.id, write);
    try { await write; } finally { if (writes.get(job.id) === write) writes.delete(job.id); }
    emit(job);
  }
  const ready = (async () => {
    await mkdir(storageRoot, { recursive: true });
    await mkdir(libraryRoot, { recursive: true });
    for (const entry of await readdir(storageRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[a-f0-9-]+\.json$/.test(entry.name)) continue;
      let job;
      try { job = JSON.parse(await readFile(join(storageRoot, entry.name), 'utf8')); } catch { continue; }
      if (job.version !== 1 || `${job.id}.json` !== entry.name || typeof job.createdAt !== 'string' || !Number.isInteger(job.seq) || !Array.isArray(job.items) || !Array.isArray(job.logs) || typeof job.sourceRoot !== 'string' || !isAbsolute(job.sourceRoot)) continue;
      try { job.snapshot = selection(job.snapshot); } catch { continue; }
      if (!within(libraryRoot, resolve(job.destination || ''))) continue;
      jobs.set(job.id, job);
      if (ACTIVE.has(job.status)) {
        job.status = 'failed';
        job.error = 'Processing was interrupted. Retry to continue.';
        for (const item of job.items) if (['copying', 'queued', 'running'].includes(item.status)) {
          item.status = 'failed'; item.error = 'Processing was interrupted. Retry to continue.';
        }
        log(job, job.error);
        await save(job);
      }
    }
  })();

  function assertOpen() { if (closed) throw new Error('The import service is closed.'); }
  function find(id) { const job = jobs.get(id); if (!job) throw new Error('Import job not found.'); return job; }
  async function copyItem(job, item, signal) {
    if (signal.aborted) throw new Error('Processing was interrupted. Retry to continue.');
    const source = resolve(job.sourceRoot, item.relativePath);
    const target = resolve(job.destination, item.relativePath);
    if (!within(job.sourceRoot, source) || !within(job.destination, target)) throw new Error('Invalid media path.');
    const info = await lstat(source);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Source is no longer a regular media file.');
    // Parent folders may have changed since scanning; never follow links to copy outside the chosen tree.
    let parent = dirname(source);
    while (within(job.sourceRoot, parent)) {
      if ((await lstat(parent)).isSymbolicLink()) throw new Error('A source folder was replaced by a link.');
      if (parent === job.sourceRoot) break;
      parent = dirname(parent);
    }
    await mkdir(dirname(target), { recursive: true });
    parent = dirname(target);
    while (within(libraryRoot, parent)) {
      if ((await lstat(parent)).isSymbolicLink()) throw new Error('A managed folder was replaced by a link.');
      if (parent === libraryRoot) break;
      parent = dirname(parent);
    }
    const tmp = join(dirname(target), `.${basename(target)}.${job.id}.partial`);
    try {
      // A hard shutdown can leave this job's unpublished copy behind. Restart that copy on the first retry.
      await rm(tmp, { force: true });
      await copyFile(source, tmp, constants.COPYFILE_EXCL);
      if (signal.aborted) throw new Error('Processing was interrupted. Retry to continue.');
      await rename(tmp, target);
    } finally { await rm(tmp, { force: true }).catch(() => {}); }
    item.managedPath = target;
    item.libraryPath = `saved/${relative(libraryRoot, target).split(sep).join('/')}`;
    item.bytes = info.size;
    item.copied = true;
  }
  async function scan(job, signal) {
    const seen = new Set(job.items.map(item => item.relativePath));
    async function walk(dir, depth) {
      if (signal.aborted) throw new Error('Processing was interrupted. Retry to continue.');
      const entries = await readdir(dir, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      for (const entry of entries) {
        if (signal.aborted) throw new Error('Processing was interrupted. Retry to continue.');
        const path = join(dir, entry.name);
        const rel = relative(job.sourceRoot, path).split(sep).join('/');
        if (seen.has(rel)) continue;
        if (entry.name.startsWith('.')) continue;
        if (entry.isDirectory() && !entry.isSymbolicLink() && depth < 7) { await walk(path, depth + 1); continue; }
        const skip = entry.isSymbolicLink() ? 'Symbolic links are skipped.' : entry.isDirectory() ? 'Folder is deeper than the media library supports.' : !entry.isFile() || !eligible(path) ? 'Unsupported file type.' : null;
        const item = { id: randomUUID(), relativePath: rel, managedPath: null, libraryPath: null, bytes: 0, copied: false, status: skip ? 'skipped' : 'queued', attempt: 0, error: null, skipReason: skip, metadata: null };
        job.items.push(item); seen.add(rel);
        await save(job);
      }
    }
    await walk(job.sourceRoot, 0);
    job.scanned = true;
    log(job, `Found ${job.items.filter(item => item.status !== 'skipped').length} supported files; ${job.items.filter(item => item.status === 'skipped').length} skipped.`);
    await save(job);
  }
  async function processJob(job, signal) {
    try {
      await validateAgent(clone(job.snapshot));
      if (!job.scanned) { job.status = 'importing'; await save(job); await scan(job, signal); }
      job.status = 'running'; job.error = null; await save(job);
      for (const item of job.items) {
        if (signal.aborted) throw new Error('Processing was interrupted. Retry to continue.');
        if (!['queued', 'failed'].includes(item.status)) continue;
        item.attempt++; item.status = 'running'; item.error = null;
        log(job, `Processing ${item.relativePath} (attempt ${item.attempt}).`, item.id);
        await save(job);
        try {
          if (!item.copied) { await copyItem(job, item, signal); log(job, `Imported ${item.relativePath}.`, item.id); await save(job); }
          if (!within(job.destination, resolve(item.managedPath || ''))) throw new Error('Managed media path is outside this import.');
          const metadata = await runAgent({ jobId: job.id, itemId: item.id, attempt: item.attempt, snapshot: clone(job.snapshot), managedPath: item.managedPath, relativePath: item.relativePath, signal }, message => {
            if (signal.aborted) return;
            log(job, typeof message === 'string' ? message : message?.message || JSON.stringify(message), item.id);
            // Keep live transcripts after a crash without writing every token as a separate disk operation.
            if (!logTimers.has(job.id)) logTimers.set(job.id, setTimeout(() => {
              logTimers.delete(job.id);
              save(job).catch(error => { job.error = `Unable to save import progress: ${errorText(error)}`; emit(job); });
            }, 150));
          });
          if (signal.aborted) throw new Error('Processing was interrupted. Retry to continue.');
          item.metadata = metadata ?? null;
          const metaFile = join(job.destination, '.zfilm-ai', `${item.relativePath}.json`);
          await mkdir(dirname(metaFile), { recursive: true });
          await writeFile(metaFile, JSON.stringify({ version: 1, source: item.relativePath, agent: job.snapshot, processedAt: now(), metadata: item.metadata }, null, 2), 'utf8');
          item.status = 'succeeded';
          log(job, `Completed ${item.relativePath}.`, item.id);
        } catch (error) {
          item.status = 'failed'; item.error = errorText(error);
          log(job, `${item.relativePath}: ${item.error}`, item.id);
        }
        await save(job);
      }
      const failed = job.items.filter(item => item.status === 'failed').length;
      const usable = job.items.filter(item => item.status !== 'skipped').length;
      job.status = failed || !usable ? 'failed' : 'succeeded';
      job.error = failed ? `${failed} imported file(s) failed. Retry to continue.` : !usable ? 'No supported files were found in this folder.' : null;
      log(job, job.error || 'Folder import and agent processing completed.');
    } catch (error) {
      job.status = 'failed'; job.error = errorText(error);
      for (const item of job.items) if (['queued', 'running'].includes(item.status)) { item.status = 'failed'; item.error = job.error; }
      log(job, job.error);
    }
    await save(job);
  }
  function schedule(job) {
    if (!pending.includes(job.id)) pending.push(job.id);
    if (draining) return;
    draining = true;
    drainPromise = (async () => {
      await ready;
      while (!closed && pending.length) {
        const id = pending.shift();
        const controller = new AbortController();
        running = { id, controller };
        try { await processJob(find(id), controller.signal); }
        catch (error) {
          const job = find(id); job.status = 'failed'; job.error = errorText(error); emit(job);
        }
        running = null;
      }
    })().finally(() => { draining = false; running = null; });
    drainPromise.catch(() => {});
  }
  return {
    async create({ sourceRoot, snapshot }) {
      await ready; assertOpen();
      const captured = selection(snapshot);
      await validateAgent(clone(captured));
      if (typeof sourceRoot !== 'string' || !isAbsolute(sourceRoot)) throw new Error('Choose a folder using the folder picker.');
      sourceRoot = resolve(sourceRoot);
      const info = await lstat(sourceRoot);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Choose a regular folder.');
      if (within(sourceRoot, libraryRoot) || within(libraryRoot, sourceRoot) || within(sourceRoot, storageRoot)) throw new Error('Choose a source folder outside the managed media library.');
      const id = randomUUID();
      const title = basename(sourceRoot).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'Imported';
      const folder = `${title}-${id.slice(0, 8)}`;
      const job = { version: 1, id, name: basename(sourceRoot), sourceRoot, destination: join(libraryRoot, folder), libraryPath: `saved/${folder}`, snapshot: captured, createdAt: now(), updatedAt: now(), status: 'queued', scanned: false, seq: 0, error: null, items: [], logs: [] };
      jobs.set(id, job);
      log(job, `Queued folder import using ${captured.agent}.`);
      await save(job);
      const result = publicJob(job);
      schedule(job);
      return result;
    },
    async listJobs() { await ready; return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicJob); },
    async getJob(id) { await ready; return publicJob(find(id)); },
    async retryFailed(id) {
      await ready; assertOpen();
      const job = find(id);
      if (ACTIVE.has(job.status)) return publicJob(job);
      const supported = job.items.filter(item => newlySupported(job, item));
      if (job.status !== 'failed' && !supported.length) return publicJob(job);
      await validateAgent(clone(job.snapshot));
      for (const item of job.items) if (item.status === 'failed') { item.status = 'queued'; item.error = null; }
      for (const item of supported) { item.status = 'queued'; item.error = null; item.skipReason = null; }
      job.status = 'queued'; job.error = null;
      log(job, supported.length
        ? `Retrying failed imports and ${supported.length} previously skipped file(s) now supported, using the original agent and model selection.`
        : 'Retrying failed imports with the original agent and model selection.');
      await save(job);
      const result = publicJob(job);
      schedule(job);
      return result;
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async close() {
      closed = true;
      running?.controller.abort();
      await drainPromise.catch(() => {});
      await ready;
      for (const id of pending.splice(0)) {
        const job = find(id); job.status = 'failed'; job.error = 'Processing was interrupted. Retry to continue.';
        log(job, job.error); await save(job);
      }
      await Promise.allSettled([...writes.values()]);
      for (const timer of logTimers.values()) clearTimeout(timer);
      logTimers.clear();
      listeners.clear();
    },
  };
}
