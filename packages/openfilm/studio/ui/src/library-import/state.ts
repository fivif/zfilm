import type { LibraryImportJob } from './types';
const timestamp = (value: string | number) => typeof value === 'number' ? value : Date.parse(value);

/** Older initial-list responses must not overwrite a more recent streamed update. */
export function mergeImportJobs(current: LibraryImportJob[], incoming: LibraryImportJob[], incomingWinsTie = true): LibraryImportJob[] {
  const jobs = new Map(current.map(job => [job.id, job]));
  for (const job of incoming) {
    const previous = jobs.get(job.id);
    if (!previous || timestamp(job.updatedAt) > timestamp(previous.updatedAt) || (incomingWinsTie && timestamp(job.updatedAt) === timestamp(previous.updatedAt))) jobs.set(job.id, job);
  }
  return [...jobs.values()].sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt) || a.id.localeCompare(b.id));
}

export function importCounts(job: LibraryImportJob) {
  const count = (status: string) => job.items.filter(item => item.status === status).length;
  const succeeded = count('succeeded');
  const failed = count('failed');
  const skipped = count('skipped');
  return { total: job.items.length, succeeded, failed, skipped, settled: succeeded + failed + skipped };
}
