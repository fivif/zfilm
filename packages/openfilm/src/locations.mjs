// @ts-check
/**
 * Where Zfilm keeps the person's work on this computer: the projects library (one folder per project, the folders
 * Studio's Projects list shows) and the exports folder. The library has a default and may be moved in Studio's
 * Settings → General: Studio's `prefs.json` (`projectsFolder`), read by Studio and by the `openfilm` command alike, so
 * a project fetched from the command line lands where Studio's go. A Studio with a home of its own (OPENFILM_HOME, as
 * `pnpm dev` and the desktop app's dev and preview builds have) shares the person's library when OPENFILM_SHARED_HOME
 * names the home that keeps it (~/.openfilm). OPENFILM_LIBRARY sets the default (a build, or a Studio kept apart);
 * what the person chose comes first. Exports go to the folder picked when exporting (the export dialog keeps the last
 * one), else to the exports default.
 *
 * Reads no Studio module, so the command can use it.
 */
import { accessSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statfsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** @type {string | null} */
let homeTaken = null;

/**
 * Studio's own home (its settings and keys, not the person's work): OPENFILM_HOME, else ~/.zfilm.
 *
 * The home it had under the old name is taken over, once, by renaming it: settings, keys, the library's cache and every
 * skill are in there, and a program that merely changed its name would open empty beside a folder holding all of it.
 * A home that cannot be renamed (open in another Zfilm, no permission) is used where it is.
 */
export function studioHomeDir() {
  if (process.env.OPENFILM_HOME) return process.env.OPENFILM_HOME;
  if (homeTaken) return homeTaken;
  const after = join(homedir(), '.zfilm');
  const before = join(homedir(), '.openfilm');
  try {
    if (!existsSync(after) && existsSync(before)) renameSync(before, after);
  } catch { /* kept where it is */ }
  homeTaken = existsSync(after) || !existsSync(before) ? after : before;
  return homeTaken;
}

/**
 * The Studio home whose prefs.json holds what every Zfilm on this computer shares (where the library is, the skills
 * turned off): OPENFILM_SHARED_HOME, else Studio's own.
 */
export const sharedHome = () => process.env.OPENFILM_SHARED_HOME || studioHomeDir();

/** One value of the shared prefs.json (`home`: the home that holds it), or undefined. @param {string} key */
export function sharedPref(key, home = sharedHome()) {
  try {
    const raw = JSON.parse(readFileSync(join(home, 'prefs.json'), 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw[key] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Keep one value in the shared prefs.json. The file is shared with every Zfilm on this computer, older or newer:
 * what this one does not know of it is written back as it was. @param {string} key @param {unknown} value
 */
export function setSharedPref(key, value, home = sharedHome()) {
  setSharedPrefs({ [key]: value }, home);
}

/** Keep related shared preferences in a single write. @param {Record<string, unknown>} patch */
export function setSharedPrefs(patch, home = sharedHome()) {
  const at = join(home, 'prefs.json');
  let kept = {};
  try { const raw = JSON.parse(readFileSync(at, 'utf8')); if (raw && typeof raw === 'object' && !Array.isArray(raw)) kept = raw; } catch { /* none yet */ }
  mkdirSync(home, { recursive: true });
  writeFileSync(`${at}.${process.pid}.tmp`, `${JSON.stringify({ ...kept, ...patch }, null, 2)}\n`);
  renameSync(`${at}.${process.pid}.tmp`, at);
}

/**
 * Take over the folder this product had under its old name, once: an app that only changed its name would otherwise
 * open on nothing, with every film of theirs still sitting one folder over. Called when Studio starts (server/main.mjs).
 * A folder the person chose always wins, and the new default's own folder is left alone once it exists.
 */
export function adoptPreviousLibrary() {
  try {
    if (chosenFolder('projectsFolder')) return null;
    const videos = join(homedir(), process.platform === 'darwin' ? 'Movies' : 'Videos');
    const before = join(videos, 'Zfilm', 'Projects');
    const here = join(videos, 'Zfilm', 'Projects');
    if (existsSync(here) || !existsSync(before)) return null;
    const films = readdirSync(before, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.'));
    if (!films.length) return null;
    chooseFolder('projectsFolder', before);
    return before;
  } catch { return null; }
}

/** Where new projects go unless the person chose: OPENFILM_LIBRARY, else ~/Movies/Zfilm/Projects on macOS, ~/Videos/Zfilm/Projects elsewhere. */
export const libraryDefault = () => process.env.OPENFILM_LIBRARY
  || join(homedir(), process.platform === 'darwin' ? 'Movies' : 'Videos', 'Zfilm', 'Projects');

/**
 * Where exports go unless a folder is picked when exporting: OPENFILM_EXPORTS, else `exports` in OPENFILM_HOME when
 * that is set (a Studio kept apart, for work on Zfilm itself, leaves nothing in the person's own folder), else the
 * Desktop.
 */
export const exportsDefault = () => process.env.OPENFILM_EXPORTS
  || (process.env.OPENFILM_HOME ? join(process.env.OPENFILM_HOME, 'exports') : '')
  || join(homedir(), 'Desktop');

const savedDefault = () => join(dirname(libraryDefault()), 'Saved');

/** Where Saved goes with the selected projects folder. Keep the original layout at the default. */
export function savedTarget(projects = chosenFolder('projectsFolder')) {
  return process.env.OPENFILM_SAVED || (projects && relative(libraryDefault(), projects) ? join(projects, 'Saved') : savedDefault());
}

/** The active library stays readable at its original location until the move finishes. */
export const savedRoot = () => process.env.OPENFILM_SAVED || chosenFolder('savedFolder') || savedDefault();

/** A folder the person chose, as kept in prefs.json: an absolute path, or null (none chosen, or not one). */
export function chosenFolder(/** @type {'projectsFolder' | 'savedFolder'} */ key) {
  const value = sharedPref(key);
  return typeof value === 'string' && isAbsolute(value) ? resolve(value) : null;
}

/**
 * Keep a folder the person chose (null: back to the default) in the shared prefs.json.
 * @param {'projectsFolder'} key @param {string | null} value
 */
export function chooseFolder(key, value) {
  setSharedPref(key, value);
}

export const libraryRoot = () => chosenFolder('projectsFolder') ?? libraryDefault();

/**
 * The projects in a library, by full path: its folders that hold a film (film.html, or Studio's `.film/id` for one
 * that lost it), not hidden ones. Nothing deeper: a project is a folder of the library.
 */
export function libraryProjects(root = libraryRoot(), saved = savedRoot()) {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => join(root, d.name))
      .filter((folder) => relative(folder, saved) !== '' && (existsSync(join(folder, 'film.html')) || existsSync(join(folder, '.film', 'id'))));
  } catch {
    return [];
  }
}

/** Where exports go when no folder is picked. */
export const exportsRoot = () => exportsDefault();

/** The free space, in bytes, on the disk a folder is on (the folder, or the nearest one above it that is there), or null. */
export function freeSpace(/** @type {string} */ folder) {
  let at = resolve(folder);
  while (!existsSync(at) && dirname(at) !== at) at = dirname(at);
  try {
    const s = statfsSync(at);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

/**
 * The projects folder and its disk space, and the current and intended locations of the personal asset library.
 */
export function locations() {
  const one = (/** @type {string} */ path, /** @type {string} */ fallback, /** @type {boolean} */ chosen) => ({ path, default: fallback, chosen, free: freeSpace(path), count: libraryProjects(path).length });
  return {
    projects: one(libraryRoot(), libraryDefault(), chosenFolder('projectsFolder') !== null),
    saved: { path: savedRoot(), target: savedTarget(), followsProjects: !process.env.OPENFILM_SAVED },
  };
}

/** Resolve junctions and links even when the last few components have yet to be created. @param {string} path @returns {string} */
function diskPath(path) {
  const parent = dirname(path);
  try { return realpathSync.native(path); }
  catch { return parent === path ? path : join(diskPath(parent), relative(parent, path)); }
}

/** A packaged app can replace everything in its installation directory during an update. */
export function requireOutsideInstallation(/** @type {string} */ path) {
  const installed = process.env.OPENFILM_INSTALL_DIR;
  if (!installed) return;
  const inside = (/** @type {string} */ root, /** @type {string} */ folder) => {
    const back = relative(root, folder);
    return !isAbsolute(back) && back.split(sep)[0] !== '..';
  };
  if (inside(installed, path) || inside(diskPath(resolve(installed)), diskPath(resolve(path)))) {
    throw new Error(`Choose a folder outside the Zfilm installation directory (${installed}). An update can replace that directory.`);
  }
}

/**
 * A folder offered for new projects, as it will be kept: absolute, not a disk's root, not inside Studio's own
 * home; made if it is not there yet. Throws a sentence the person can read.
 * @param {unknown} value @returns {string}
 */
export function usableFolder(value) {
  if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('Choose a folder by its full path.');
  const path = resolve(value);
  if (dirname(path) === path) throw new Error('Choose a folder on that disk, not the disk itself.');
  requireOutsideInstallation(path);
  for (const home of new Set([resolve(studioHomeDir()), resolve(sharedHome())])) {
    if (path === home || path.startsWith(home + sep)) throw new Error('Zfilm keeps its own settings there: choose another folder.');
  }
  try {
    mkdirSync(path, { recursive: true });
    accessSync(path, constants.W_OK);
  } catch {
    throw new Error('That folder cannot be written to: choose another one.');
  }
  return path;
}
