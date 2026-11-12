/**
 * This build never updates itself.
 *
 * The upstream app checks a feed written into it at build time, downloads the next version in the background, offers
 * Restart, installs on quit, and finishes an install at the next launch (updates.mjs, update-*.mjs). This tree keeps
 * none of that: no feed is built into the app (scripts/release.mjs writes no `publish` config, so no app-update.yml),
 * nothing is checked for, nothing is downloaded, and no menu, IPC or Studio top-bar entry is offered. The export
 * below keeps `startUpdates`'s shape so `main.mjs` needs no branch of its own.
 */
import { app } from 'electron';

/** @type {Record<string, unknown>} the state every page reads: `off`, at this version */
const off = () => ({ status: 'off', version: app.getVersion(), channel: 'stable', availableVersion: null, progress: 0, checkedAt: null, error: null });

/**
 * @param {{ dataDir: string, productName: string, getWindow: () => Electron.BaseWindow | null,
 *           onState: (state: object) => void,
 *           prepareRestart: () => Promise<{ ok: true } | { ok: false, error: string }>,
 *           beforeInstall: () => Promise<void> }} _options unused: this build has no updates
 */
export function startUpdates(_options) {
  const state = off();
  return {
    /* false: the menu and Settings drop "Check for Updates…" and say the build updates itself nowhere */
    packaged: false,
    snapshot: () => state,
    check: async () => state,
    restart: async () => ({ ok: false, error: 'no-updates' }),
    manualCheck: null,
    installAtLaunch: async () => ({ installing: false, dismiss: () => {} }),
    channel: () => 'stable',
    setChannel: () => {},
    close: () => {},
  };
}
