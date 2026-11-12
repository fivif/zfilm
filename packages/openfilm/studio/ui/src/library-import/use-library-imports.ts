import React from 'react';
import type { LibraryImportHost, LibraryImportJob } from './types';
import { mergeImportJobs } from './state';

export function useLibraryImports(host: LibraryImportHost | undefined) {
  const [jobs, setJobs] = React.useState<LibraryImportJob[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const mounted = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
    if (!host) return () => { mounted.current = false; };
    let active = true;
    const stop = host.onChange(job => {
      if (active) setJobs(previous => mergeImportJobs(previous, [job]));
    });
    void host.listJobs().then(next => {
      if (active) { setJobs(previous => mergeImportJobs(previous, next, false)); setError(null); }
    }, reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; mounted.current = false; stop(); };
  }, [host]);

  const run = React.useCallback(async (id: string, operation: () => Promise<LibraryImportJob | null>) => {
    setBusy(id);
    setError(null);
    try {
      const next = await operation();
      if (mounted.current && next) setJobs(previous => mergeImportJobs(previous, [next]));
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, []);

  return {
    jobs, error, busy,
    importFolder: () => { if (host && !busy) void run('import', () => host.pickAndImport()); },
    retryFailed: (id: string) => { if (host && !busy) void run(id, () => host.retryFailed(id)); },
  };
}
