// @ts-check
/**
 * Fetching the published library whole, so a film can be made with no line: the list comes from the catalogs that
 * ship in the package (they name every sound, every piece of music, every emoji sticker), a sticker comes as a bundle
 * whole; the fetching runs here in Studio, can be paused, goes on where it stopped, and what it brings is counted so
 * Settings can show how much of the library is on this computer. The host publishes no manifest of sizes: each file's
 * size is learned as it arrives, and what was here before is measured once.
 *
 *   ~/.openfilm/library/<path>          the fetched parts, as library.mjs keeps them
 *   ~/.openfilm/library/.sync.json      how far it got: finished files' sizes, and the last run's failure, if one
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { builtInRoot, fetchLibrary, lastLibraryError, libraryCache } from './library.mjs';
import { savedProxy, saveProxy } from './library-proxy.mjs';

/**
 * Four at a time. The host is one machine, and its name is looked up by whichever request opens the connection: more
 * workers on a slow resolver only make it fail faster (measured here: eight at once failed where one at a time went
 * through, and the pool then reused that one connection for everything after it).
 */
const WORKERS = 6;

/** @typedef {{ id: string, files: string[], bundles: string[] }} Part */
/** @typedef {{ id: string, files: number, done: number, bytes: number }} PartCount */

const readJson = (/** @type {string} */ at) => {
  try { return JSON.parse(readFileSync(at, 'utf8')); } catch { return null; }
};

/** The sizes seen, by path: what was measured before this run and what each fetch brought. */
let sizes = /** @type {Record<string, number>} */ ({});
let sizesLoaded = false;
/** @type {Part[] | null} */
let parts = null;

const stateFile = () => join(libraryCache(), '.sync.json');

function loadSizes() {
  if (sizesLoaded) return;
  sizesLoaded = true;
  const state = readJson(stateFile());
  if (state && typeof state.sizes === 'object' && state.sizes) {
    for (const [path, bytes] of Object.entries(state.sizes)) if (typeof bytes === 'number') sizes[path] = bytes;
  }
}

/** @type {any} */ let saving = null;
/** Written whole and not often: after each finished file the map is still in memory, and one save follows every 40. */
function saveSizes(/** @type {boolean} */ now = false) {
  if (saving && !now) return;
  const write = () => {
    saving = null;
    try {
      mkdirSync(libraryCache(), { recursive: true });
      writeFileSync(stateFile(), `${JSON.stringify({ version: 1, sizes, lastRun: lastRun })}\n`);
    } catch { /* a full disk: the fetching says so itself */ }
  };
  if (now) write();
  else { saving = /** @type {any} */ (setTimeout(write, 1500)); saving.unref?.(); }
}

/** @type {{ startedAt: number, part: string | null, failures: { path: string, error: string }[] } | null} */
let lastRun = null;

/** What a part is made of: the files it fetches one at a time, and the bundles it fetches whole. */
export function plan() {
  if (parts) return parts;
  const audio = readJson(join(builtInRoot(), 'audio.json'));
  const stickers = readJson(join(builtInRoot(), 'stickers.json'));
  /** @type {{ id?: string, cat?: string, cover?: string }[]} */
  const sounds = Array.isArray(audio?.items) ? audio.items : [];
  /** @type {string[]} */
  const covers = [...new Set(sounds.map((i) => i?.cover).filter((c) => typeof c === 'string'))];
  /** @type {{ id?: unknown }[]} */
  const stickerItems = Array.isArray(stickers?.items) ? stickers.items : [];
  parts = [
    { id: 'music', files: sounds.filter((i) => i?.cat === 'music' && typeof i.id === 'string').map((i) => /** @type {string} */ (i.id)), bundles: [] },
    { id: 'sfx', files: sounds.filter((i) => i?.cat === 'sound' && typeof i.id === 'string').map((i) => /** @type {string} */ (i.id)), bundles: [] },
    { id: 'covers', files: covers, bundles: [] },
    { id: 'stickers', files: [], bundles: stickerItems.map((i) => i?.id).filter((id) => typeof id === 'string').map((id) => /** @type {string} */ (id)) },
  ];
  return parts;
}

const here = (/** @type {string} */ path) => existsSync(join(builtInRoot(), path)) || existsSync(join(libraryCache(), path));

/** A bundle counts as here when its folder is there and no `.partial` says it stopped halfway. */
function bundleHere(/** @type {string} */ path) {
  for (const root of [builtInRoot(), libraryCache()]) {
    const at = join(root, path);
    if (!existsSync(at)) continue;
    if (root === builtInRoot()) return true;
    if (existsSync(join(at, '.partial'))) return false;
    return true;
  }
  return false;
}

function sizeOf(/** @type {string} */ path) {
  const known = sizes[path];
  if (typeof known === 'number') return known;
  try {
    const at = join(libraryCache(), path);
    if (existsSync(at)) { sizes[path] = statSync(at).size; return sizes[path]; }
    const built = join(builtInRoot(), path);
    if (existsSync(built)) { sizes[path] = 0; return 0; }
  } catch { /* gone meanwhile */ }
  return 0;
}

/** Where the fetching is: what each part has, how many files and bytes. */
export function status() {
  loadSizes();
  /** @type {PartCount[]} */
  const list = plan().map((part) => {
    let done = 0; let bytes = 0;
    for (const path of part.files) if (here(path)) { done += 1; bytes += sizeOf(path); }
    for (const path of part.bundles) if (bundleHere(path)) done += 1;
    return { id: part.id, files: part.files.length + part.bundles.length, done, bytes };
  });
  const total = list.reduce((n, p) => n + p.files, 0);
  const have = list.reduce((n, p) => n + p.done, 0);
  return {
    parts: list,
    total,
    have,
    bytes: list.reduce((n, p) => n + p.bytes, 0),
    running: running ? { part: running.part, startedAt: running.startedAt, at: running.at } : null,
    failures: lastRun?.failures.slice(0, 20) ?? [],
    where: libraryCache(),
    /** the proxy these downloads go through, and no other request: '' when direct */
    proxy: savedProxy(),
  };
}

/** @type {{ part: string | null, startedAt: number, stop: boolean, waiters: (() => void)[], at: string | null } | null} */
let running = null;

/**
 * Fetch what is not here yet. `ids` names the parts (music, sfx, covers, stickers); none means all. Answers at once:
 * the fetching goes on in Studio, and `/api/library/status` says how it goes.
 * @param {string[]} [ids]
 */
export function start(ids) {
  if (running) return status();
  const wanted = new Set(ids?.length ? ids : plan().map((p) => p.id));
  const todo = plan().filter((p) => wanted.has(p.id));
  if (!todo.length) return status();
  running = { part: null, startedAt: Date.now(), stop: false, waiters: [], at: null };
  lastRun = { startedAt: running.startedAt, part: null, failures: [] };
  const job = running;
  void (async () => {
    try {
      for (const part of todo) {
        job.part = part.id;
        if (lastRun) lastRun.part = part.id;
        await runPart(part, job);
        if (job.stop) break;
      }
    } catch (e) {
      lastRun?.failures.push({ path: '', error: e instanceof Error ? e.message : String(e) });
    } finally {
      running = null;
      saveSizes(true);
      for (const wake of job.waiters) wake();
    }
  })();
  return status();
}

/** @param {Part} part @param {{ stop: boolean }} job */
async function runPart(part, job) {
  /** @type {{ path: string, bundle: boolean }[]} */
  const queue = [];
  for (const path of part.files) if (!here(path)) queue.push({ path, bundle: false });
  for (const path of part.bundles) if (!bundleHere(path)) queue.push({ path, bundle: true });
  if (!queue.length) return;
  let at = 0;
  let finished = 0;
  /** One file: fetched, its size kept, its failure (with the reason) noted; nothing throws out of here. */
  const attempt = async (/** @type {{ path: string, bundle: boolean }} */ { path, bundle }) => {
    if (running) running.at = path;
    let reason = null;
    for (let tries = 0; tries < 3; tries += 1) {
      reason = null;
      try { await fetchLibrary(path); } catch (e) { reason = e instanceof Error ? e.message : String(e); }
      /* The directory exists as soon as a bundle starts, but .partial means children are still missing. */
      if (bundle ? bundleHere(path) : here(path)) { reason = null; break; }
      reason ??= lastLibraryError() ?? `the library's ${path} is incomplete`;
      if (tries < 2) await new Promise((done) => { setTimeout(done, [500, 1500][tries]); });
    }
    if (reason) lastRun?.failures.push({ path, error: reason });
    else { const size = sizeOf(path); if (size) sizes[path] = size; }
    finished += 1;
    if (finished % 40 === 0) saveSizes(true);
  };
  if (!job.stop) await attempt(queue[at++]);
  const worker = async () => {
    for (;;) {
      if (job.stop) return;
      const path = queue[at++];
      if (path === undefined) return;
      await attempt(path);
    }
  };
  await Promise.all(Array.from({ length: Math.min(WORKERS, queue.length) }, worker));
  saveSizes(true);
}

/** Stop after the files in flight: what is under way is finished, so nothing is left half written. */
export function pause() {
  if (running) running.stop = true;
  return status();
}

/** Answers when nothing is being fetched any more (the tests use it; the page asks status instead). */
export function whenIdle() {
  if (!running) return Promise.resolve();
  return new Promise((resolve) => { running?.waiters.push(/** @type {() => void} */ (resolve)); });
}

/**
 * Take what was fetched for these parts away again (the person asked for the room). Only `~/.openfilm/library`.
 * @param {string[]} ids
 */
export function clear(ids) {
  if (running) throw new Error('stop the fetching first');
  const wanted = new Set(ids.length ? ids : plan().map((p) => p.id));
  for (const part of plan()) {
    if (!wanted.has(part.id)) continue;
    for (const path of part.files) {
      if (existsSync(join(builtInRoot(), path))) continue;
      rmSync(join(libraryCache(), path), { force: true });
      delete sizes[path];
    }
    for (const path of part.bundles) {
      if (existsSync(join(builtInRoot(), path))) continue;
      rmSync(join(libraryCache(), path), { recursive: true, force: true });
    }
  }
  saveSizes(true);
  return status();
}

/**
 * Settings → Library: `GET status`, `POST sync { action: 'start' | 'pause' | 'clear', parts? }`. Clear needs
 * `confirm: true`: it deletes what was fetched.
 * @param {import('./server.mjs').Req} req @param {import('./server.mjs').Res} res @param {string} what
 */
export async function librarySyncRoute(req, res, what) {
  const json = (/** @type {number} */ code, /** @type {unknown} */ body) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  if (what === 'status' && req.method === 'GET') return json(200, status());
  if (what === 'sync' && req.method === 'POST') {
    let body = /** @type {{ action?: unknown, parts?: unknown, confirm?: unknown, proxy?: unknown }} */ ({});
    try {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      body = raw ? JSON.parse(raw) : {};
    } catch { return json(400, { error: 'a JSON body, please' }); }
    const parts = Array.isArray(body.parts) ? body.parts.filter((p) => typeof p === 'string') : [];
    if (body.action === 'proxy') {
      try { saveProxy(typeof body.proxy === 'string' ? body.proxy : ''); } catch (e) { return json(400, { error: e instanceof Error ? e.message : String(e) }); }
      return json(200, status());
    }
    if (body.action === 'start') return json(200, start(parts));
    if (body.action === 'pause') return json(200, pause());
    if (body.action === 'clear') {
      if (body.confirm !== true) return json(400, { error: 'clearing deletes what was fetched: send confirm: true', code: 'confirm' });
      try { return json(200, clear(parts)); } catch (e) { return json(409, { error: e instanceof Error ? e.message : String(e) }); }
    }
    return json(400, { error: "action is 'start', 'pause' or 'clear'" });
  }
  return json(404, { error: 'no such library call' });
}

/** For the tests and for a fresh look after the package changed: forget what was worked out. */
export function forget() {
  parts = null; sizes = {}; sizesLoaded = false; lastRun = null;
}
