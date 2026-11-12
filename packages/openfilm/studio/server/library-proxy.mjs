// @ts-check
/**
 * The proxy the library's downloads go through, and no other request: a person whose network reaches
 * openfilm.dev's file host only through a proxy keeps its name and port here. http, https and socks (4, 5, 5h) are
 * answerable; an empty name means direct.
 *
 *   ~/.openfilm/library-proxy.json   { version: 1, proxy: "http://127.0.0.1:10808" }, readable by this user only (0600)
 *
 * The agents are made once per name and kept: a thousand downloads through one proxy keep one connection pool.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { studioHomeDir } from '../../src/locations.mjs';

/** @typedef {import('node:http').Agent} HttpAgent */

/** Where it is kept: beside the other settings, not in a project. */
export const proxyFile = () => join(studioHomeDir(), 'library-proxy.json');

/** http, https, socks4, socks5 and socks5h, with an optional name and password, and a port. */
const PROXY = /^(https?|socks4a?|socks5h?):\/\/(?:[^\s:@/]+(?::[^\s@/]*)?@)?(\[[0-9a-f:.]+\]|[a-z0-9.-]+):(\d{1,5})\/?$/i;

/** Why a name is not a proxy, or null when it is one (empty: direct, which is not an error). */
export function proxyProblem(/** @type {unknown} */ value) {
  if (typeof value !== 'string') return 'a proxy is text';
  const name = value.trim();
  if (!name) return null;
  if (name.length > 300) return 'that proxy name is too long';
  if (!PROXY.test(name)) return 'a proxy looks like http://host:port or socks5://host:port';
  const port = Number(/** @type {RegExpMatchArray} */ (name.match(PROXY))[3]);
  if (!(port > 0 && port <= 65535)) return 'a proxy port is 1 to 65535';
  return null;
}

/** The proxy saved here; '' for direct (and when the file is missing or unreadable). */
export function savedProxy() {
  try {
    const data = JSON.parse(readFileSync(proxyFile(), 'utf8'));
    return typeof data?.proxy === 'string' && !proxyProblem(data.proxy) ? data.proxy.trim() : '';
  } catch { return ''; }
}

/** Save one (empty: direct). Answers the name now saved. */
export function saveProxy(/** @type {string} */ value) {
  const name = String(value ?? '').trim();
  const problem = proxyProblem(name);
  if (problem) throw new Error(problem);
  const at = proxyFile();
  if (!name) { rmSync(at, { force: true }); memory = ''; return ''; }
  mkdirSync(dirname(at), { recursive: true });
  const part = `${at}.part-${process.pid}`;
  writeFileSync(part, `${JSON.stringify({ version: 1, proxy: name })}\n`, { mode: 0o600 });
  renameSync(part, at);
  try { chmodSync(at, 0o600); } catch { /* a file system without modes */ }
  memory = name;
  return name;
}

/** @type {string | null} */
let memory = null;
/** @type {{ name: string, agent: HttpAgent } | null} */
let made = null;

/**
 * The agent to send the library's downloads through, or null to go direct. socks5:// is taken as socks5h://: the name
 * is looked up at the proxy, which is what a person behind a walled network means by it.
 * @returns {Promise<HttpAgent | null>}
 */
export async function proxyAgent() {
  if (memory === null) memory = savedProxy();
  const name = memory;
  if (!name) return null;
  if (made?.name === name) return made.agent;
  const { URL } = await import('node:url');
  const url = new URL(name);
  let agent;
  if (/^socks/i.test(url.protocol)) {
    const { SocksProxyAgent } = await import('socks-proxy-agent');
    agent = new SocksProxyAgent(name.replace(/^socks5:/i, 'socks5h:'));
  } else {
    const { HttpsProxyAgent } = await import('https-proxy-agent');
    agent = new HttpsProxyAgent(name);
  }
  made = { name, agent };
  return agent;
}

/** For the tests: forget what was read and made. */
export function forgetProxy() {
  memory = null;
  made = null;
}

/** Whether a proxy file is there at all (the tests and the page's first look). */
export const hasProxyFile = () => existsSync(proxyFile());
