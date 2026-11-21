/**
 * This build never updates itself.
 *
 * The upstream app checks a feed written into it at build time, downloads the next version in the background, offers
 * Restart, installs on quit, and finishes an install at the next launch (updates.mjs, update-*.mjs). This tree keeps
 * none of that: no feed is built into the app (scripts/release.mjs writes no `publish` config, so no app-update.yml),
 * nothing is checked for, nothing is downloaded, and no menu, IPC or Studio top-bar entry is offered.
 *
 * The export below keeps `startUpdates`'s shape so `main.mjs` needs no branch of its own: every call answers as a build
 * with nothing to update would.
 */
import { app } from 'electron';

/** @type {Record<string, unknown>} the state every page reads: `off`, at this version */
const off = () => ({
  status: 'off',
  version: app.getVersion(),
  channel: 'stable',
  availableVersion: null,
  progress: 0,
  checkedAt: null,
  error: null,
});

/**
 * @param {{ dataDir: string, productName: string, getWindow: () => Electron.BaseWindow | null,
 *           onState: (state: object) => void,
 *           prepareRestart: () => Promise<{ ok: true } | { ok: false, error: string }>,
 *           beforeInstall: () => Promise<void> }} _options unused: this build has no updates
 */
export function startUpdates(_options) {
  let channel = 'stable';
  return {
    /* no updater: the menu, the window's page and Studio's top bar offer nothing (`updates.packaged`) */
    packaged: false,
    snapshot: off,
    /** Check now, quietly: there is nothing to check, and nothing to find */
    check: async () => off(),
    /** The menu's check answers as the page's does: nothing to find */
    manualCheck: async (_language) => off(),
    /** Nothing was downloaded, so there is nothing to restart into */
    restart: async () => ({ ok: false, error: 'This build has no updates.' }),
    installAtLaunch: async (_options = {}) => ({ installing: false, dismiss: () => {} }),
    channel: () => channel,
    setChannel(_next) { /* no channel to move to */ },
    close() { /* nothing runs */ },
  };
}
