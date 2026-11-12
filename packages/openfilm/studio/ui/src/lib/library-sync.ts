/**
 * The library as this computer has it: how much of it is fetched, and fetching the rest (library-sync.mjs on the
 * server). Asks again while a fetch runs, so the counts climb in front of the person; stops asking once it is done or
 * was paused.
 */
import React from 'react';

/** One part of the library (music, sounds, covers, emoji stickers) as Settings shows it. */
export interface LibraryPart {
  id: string;
  /** how many files (or bundles) it is made of */
  files: number;
  /** how many are on this computer */
  done: number;
  /** bytes of those that are, as far as is known */
  bytes: number;
}

export interface LibraryState {
  parts: LibraryPart[];
  total: number;
  have: number;
  bytes: number;
  running: { part: string | null; startedAt: number } | null;
  failures: { path: string; error: string }[];
  where: string;
  /** the proxy the downloads go through, and nothing else: '' when direct */
  proxy: string;
}

const POLL_MS = 1500;

/** Calls `/api/library/*`; the server fetches, so a closed window changes nothing. */
async function call(path: string, body?: unknown) {
  const res = await fetch(`/api/library/${path}`, body === undefined ? { method: 'GET' } : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `the library answered ${res.status}`);
  return data as LibraryState;
}

export function useLibrary() {
  const [state, setState] = React.useState<LibraryState | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const timer = React.useRef<number | null>(null);
  const stop = React.useRef(false);

  const ask = React.useCallback(async () => {
    try {
      const next = await call('status', undefined);
      if (stop.current) return;
      setState(next);
      setError(null);
    } catch (e) {
      if (!stop.current) setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  /* ask now, then again while the server is fetching */
  React.useEffect(() => {
    stop.current = false;
    void ask();
    return () => { stop.current = true; if (timer.current !== null) window.clearTimeout(timer.current); };
  }, [ask]);

  React.useEffect(() => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    if (!state?.running) return;
    timer.current = window.setTimeout(() => { void ask(); }, POLL_MS);
    return () => { if (timer.current !== null) window.clearTimeout(timer.current); };
  }, [state, ask]);

  const send = React.useCallback(async (what: string, body: unknown) => {
    setBusy(what);
    try {
      setState(await call('sync', body));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  return {
    state,
    busy,
    error,
    refresh: ask,
    start: (parts: string[] = []) => send('start', { action: 'start', parts }),
    pause: () => send('pause', { action: 'pause' }),
    clear: (parts: string[] = []) => send('clear', { action: 'clear', parts, confirm: true }),
    setProxy: (proxy: string) => send('proxy', { action: 'proxy', proxy }),
  };
}
