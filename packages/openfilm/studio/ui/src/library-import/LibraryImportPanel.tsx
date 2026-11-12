import React from 'react';
import { Check, ChevronDown, FolderInput, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/i18n';
import { studioHost, type StudioHost } from '@/lib/host';
import { SettingsButton, SettingsGroup, SettingsItem } from '@/components/settings/ui';
import type { LibraryImportHost, LibraryImportJob } from './types';
import { importCounts } from './state';
import { importMessages, type ImportWords } from './messages';
import { useLibraryImports } from './use-library-imports';

function JobCard({ job, words, busy, disabled, retry }: { job: LibraryImportJob; words: ImportWords; busy: boolean; disabled: boolean; retry: () => void }) {
  const counts = importCounts(job);
  const working = job.status === 'importing' || job.status === 'queued' || job.status === 'running';
  const percent = counts.total ? Math.round(counts.settled / counts.total * 100) : 0;
  const log = React.useRef<HTMLDivElement>(null);
  const follow = React.useRef(true);
  React.useEffect(() => {
    if (follow.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [job.logs.length, job.logs.at(-1)?.seq]);
  const status = job.status === 'failed' ? words.failedStatus : words[job.status];
  const model = job.snapshot.options.model ?? job.snapshot.options.modelId;
  return (
    <article className="py-4" aria-label={job.name}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="break-words text-[15px] font-medium text-[var(--text)]">{job.name}</p>
          <p className="mt-1 break-all text-[12px] text-[var(--text-faint)]">{job.sourceRoot}</p>
        </div>
        {!working && (job.status === 'failed' || (job.retryableSkipped ?? 0) > 0) ? (
          <SettingsButton onClick={retry} disabled={disabled} aria-label={`${words.retry}: ${job.name}`}>
            <RefreshCw size={14} />{busy ? words.retrying : words.retry}
          </SettingsButton>
        ) : null}
      </div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[13px] text-[var(--text-muted)]" role="status">
        <span className={job.status === 'failed' ? 'text-[var(--err)]' : ''}>
          {job.status === 'succeeded' ? <Check size={13} className="mr-1 inline" /> : null}{status}
        </span>
        <span>{counts.succeeded} {words.success} · {counts.failed} {words.failed} · {counts.skipped} {words.skipped} / {counts.total} {words.total}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-pressed)]" role="progressbar" aria-label={`${words.progress}: ${job.name}`}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.status === 'importing' ? undefined : percent} aria-valuetext={status}>
        <div className={`h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none ${counts.failed ? 'bg-[var(--err)]' : 'bg-[var(--accent)]'}`}
          style={{ width: `${job.status === 'importing' ? 0 : percent}%` }} />
      </div>
      <p className="mt-2 break-words text-[12px] text-[var(--text-faint)]">{words.agent}: {job.snapshot.agent}{model ? ` · ${words.model}: ${model}` : ''}</p>
      {job.error ? <p className="mt-2 break-words text-[13px] text-[var(--err)]">{job.error}</p> : null}
      <details className="group mt-3" open={working || undefined}>
        <summary className="flex cursor-pointer list-none items-center gap-1 text-[13px] text-[var(--text-muted)] outline-offset-4 hover:text-[var(--text)]">
          <ChevronDown size={14} className="-rotate-90 transition-transform group-open:rotate-0 motion-reduce:transition-none" />{words.details}
        </summary>
        <ul className="mt-2 max-h-48 overflow-y-auto rounded-[8px] border border-[var(--border)] px-3 divide-y divide-[var(--border)]" aria-label={words.details}>
          {job.items.map(item => (
            <li key={item.id} className="py-2 text-[12px]">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 break-all text-[var(--text-muted)]">{item.relativePath}</span>
                <span className={`shrink-0 ${item.status === 'failed' ? 'text-[var(--err)]' : 'text-[var(--text-faint)]'}`}>
                  {item.status === 'failed' ? words.itemFailed : item.status === 'skipped' ? words.itemSkipped : words[item.status]}
                </span>
              </div>
              {(item.attempt ?? 0) > 1 ? <p className="mt-0.5 text-[var(--text-faint)]">{words.attempt}: {item.attempt}</p> : null}
              {item.metadata?.title ? <p className="mt-1 font-medium text-[var(--text-muted)]">{item.metadata.title}</p> : null}
              {item.metadata?.description ? <p className="mt-1 whitespace-pre-wrap text-[var(--text-faint)]">{item.metadata.description}</p> : null}
              {item.metadata?.tags?.length ? <p className="mt-1 text-[var(--text-faint)]">{item.metadata.tags.join(' · ')}</p> : null}
              {item.error || item.skipReason ? <p className={`mt-1 break-words ${item.error ? 'text-[var(--err)]' : 'text-[var(--text-faint)]'}`}>{item.error || item.skipReason}</p> : null}
            </li>
          ))}
        </ul>
        <div ref={log} role="log" aria-label={words.logs} aria-live="off" tabIndex={0}
          onScroll={event => { const area = event.currentTarget; follow.current = area.scrollHeight - area.scrollTop - area.clientHeight < 32; }}
          className="mt-2 max-h-56 overflow-y-auto rounded-[8px] bg-[var(--bg-field)] p-3 font-mono text-[11px] leading-relaxed text-[var(--text-muted)]">
          {job.logs.length ? job.logs.map(row => <p key={row.seq} className="whitespace-pre-wrap break-words"><span className="text-[var(--text-faint)]">{new Date(row.time).toLocaleTimeString()} </span>{row.message}</p>) : words.noLogs}
        </div>
      </details>
    </article>
  );
}

/** This native-only section does not offer a browser folder upload with a different processing contract. */
export function LibraryImportPanel() {
  const language = useLanguage();
  const words: ImportWords = importMessages[language === 'zh-CN' ? 'zh-CN' : 'en'];
  const host = (studioHost as (StudioHost & { libraryImport?: LibraryImportHost }) | null)?.libraryImport;
  const imports = useLibraryImports(host);
  const [, refreshSelection] = React.useReducer(value => value + 1, 0);
  React.useEffect(() => {
    if (!host) return;
    const timer = setInterval(refreshSelection, 1500);
    return () => clearInterval(timer);
  }, [host]);
  if (!host) return null;
  const selected = studioHost?.libraryImport?.selection ? studioHost.libraryImport.selection() : studioHost?.canvasWriting?.selection();
  const model = selected?.options.model ?? selected?.options.modelId;
  return (
    <SettingsGroup title={words.title} footnote={words.footnote}>
      <SettingsItem mark={<FolderInput size={17} strokeWidth={1.75} />} title={words.description}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 break-words text-[13px] text-[var(--text-muted)]">{selected ? `${words.currentAgent}: ${selected.agent}${model ? ` · ${model}` : ''}` : words.unavailable}</p>
          <SettingsButton onClick={imports.importFolder} disabled={Boolean(imports.busy) || !selected}>
            <FolderInput size={15} />{imports.busy === 'import' ? words.picking : words.import}
          </SettingsButton>
        </div>
        {imports.error ? <p role="alert" className="mt-2 break-words text-[13px] text-[var(--err)]">{imports.error}</p> : null}
      </SettingsItem>
      {imports.jobs.length ? imports.jobs.map(job => (
        <JobCard key={job.id} job={job} words={words} busy={imports.busy === job.id} disabled={Boolean(imports.busy)} retry={() => imports.retryFailed(job.id)} />
      )) : <p className="py-4 text-[13px] text-[var(--text-faint)]">{words.empty}</p>}
    </SettingsGroup>
  );
}
