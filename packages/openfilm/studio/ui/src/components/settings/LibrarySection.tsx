/**
 * Settings → Library: what of the material library is on this computer and fetching the rest, so a film can be made
 * with no line. The fetching runs on the server (library-sync.mjs), so closing the window changes nothing; the counts
 * climb while it runs, and clearing takes the fetched files away again (asked twice: it deletes).
 */
import React from 'react';
import { Check, Download, HardDriveDownload, Music, Sparkles, Square, Trash2, Waves } from 'lucide-react';
import { useT } from '@/i18n';
import { useLibrary, type LibraryPart } from '@/lib/library-sync';
import { SettingsButton, SettingsField, SettingsGroup, SettingsItem, SettingsPage, SettingsStatus } from './ui';
import { LibraryImportPanel } from '@/library-import/LibraryImportPanel';

const MARK: Record<string, React.ReactNode> = {
  music: <Music size={17} strokeWidth={1.75} />,
  sfx: <Waves size={17} strokeWidth={1.75} />,
  covers: <Sparkles size={17} strokeWidth={1.75} />,
  stickers: <HardDriveDownload size={17} strokeWidth={1.75} />,
};

const LABEL: Record<string, string> = {
  music: 'settings.library.music',
  sfx: 'settings.library.sfx',
  covers: 'settings.library.covers',
  stickers: 'settings.library.stickers',
};

/** Gigabytes, megabytes, kilobytes: what a person reads, not the exact count of bytes. */
export function sizeText(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function Bar({ done, total }: { done: number; total: number }) {
  const percent = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-pressed)]" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500" style={{ width: `${percent}%` }} />
    </div>
  );
}

export function LibrarySection() {
  const t = useT();
  const lib = useLibrary();
  const state = lib.state;
  const [confirming, setConfirming] = React.useState(false);
  const [proxy, setProxy] = React.useState('');
  const [editing, setEditing] = React.useState(false);
  const running = Boolean(state?.running);
  React.useEffect(() => { if (!editing && state) setProxy(state.proxy ?? ''); }, [state?.proxy, editing]);
  const have = state?.have ?? 0;
  const done = Boolean(state && state.total > 0 && have >= state.total);
  const unit = t('settings.library.fileUnit');
  const part = (p: LibraryPart) => (
    <SettingsItem key={p.id} mark={MARK[p.id] ?? <HardDriveDownload size={17} strokeWidth={1.75} />}
      title={t(LABEL[p.id] ?? 'settings.library.title')}
      description={`${p.done} / ${p.files} ${unit}`}
      control={(
        <div className="w-[168px]">
          <Bar done={p.done} total={p.files} />
          <p className="mt-1.5 text-right text-[12px] text-[var(--text-faint)]">{sizeText(p.bytes)}</p>
        </div>
      )} />
  );
  return (
    <SettingsPage note={t('settings.library.about')}>
      <LibraryImportPanel />
      <SettingsGroup title={t('settings.library.offline')}
        footnote={state ? <>{t('settings.library.where')} <span className="text-[var(--text-muted)]">{state.where}</span></> : undefined}>
        <div className="py-4">
          <div className="mb-2 flex items-baseline justify-between gap-4">
            <p className="text-[15px] font-medium text-[var(--text)]">
              {state ? `${t('settings.library.downloaded')} ${have} / ${state.total} ${unit}` : t('settings.library.reading')}
            </p>
            <p className="text-[13px] text-[var(--text-muted)]">{state ? sizeText(state.bytes) : ''}</p>
          </div>
          <Bar done={have} total={state?.total ?? 0} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <SettingsButton onClick={() => void lib.start()} disabled={running || done}>
              <Download size={15} strokeWidth={2} />{running ? t('settings.library.fetching') : t('settings.library.fetchAll')}
            </SettingsButton>
            <SettingsButton onClick={() => void lib.pause()} disabled={!running}>
              <Square size={14} strokeWidth={2} />{t('settings.library.pause')}
            </SettingsButton>
            {done ? <SettingsStatus><Check size={13} strokeWidth={2.5} />{t('settings.library.allHere')}</SettingsStatus> : null}
            {confirming ? (
              <>
                <SettingsButton onClick={() => { setConfirming(false); void lib.clear(); }} disabled={running}
                  className="text-[var(--err)]">{t('settings.library.clearYes')}</SettingsButton>
                <SettingsButton onClick={() => setConfirming(false)}>{t('settings.library.clearNo')}</SettingsButton>
              </>
            ) : (
              <SettingsButton onClick={() => setConfirming(true)} disabled={running || have === 0}>
                <Trash2 size={14} strokeWidth={2} />{t('settings.library.clear')}
              </SettingsButton>
            )}
          </div>
          {confirming ? <p className="mt-2 text-[13px] text-[var(--text-muted)]">{t('settings.library.clearAsk')}</p> : null}
          {lib.error ? <p className="mt-2 text-[13px] text-[var(--err)]">{lib.error}</p> : null}
          {state?.failures.length ? (
            <p className="mt-2 text-[13px] text-[var(--text-muted)]">{t('settings.library.someFailed')} ({state.failures.length})</p>
          ) : null}
        </div>
        {(state?.parts ?? []).map(part)}
      </SettingsGroup>

      <SettingsGroup title={t('settings.library.proxyTitle')} footnote={t('settings.library.proxyOnly')}>
        <SettingsItem mark={<Download size={17} strokeWidth={1.75} />}
          title={t('settings.library.proxy')}
          description={t('settings.library.proxyHint')}
          control={(
            <div className="flex items-center gap-2">
              <SettingsField value={proxy} onChange={(event) => { setEditing(true); setProxy(event.target.value); }}
                placeholder="http://127.0.0.1:10808" spellCheck={false} autoComplete="off" className="w-[240px]" />
              <SettingsButton onClick={() => { setEditing(false); void lib.setProxy(proxy.trim()); }}>{t('settings.library.proxySave')}</SettingsButton>
              {state?.proxy ? <SettingsButton onClick={() => { setEditing(false); setProxy(''); void lib.setProxy(''); }}>{t('settings.library.proxyClear')}</SettingsButton> : null}
            </div>
          )} />
      </SettingsGroup>
    </SettingsPage>
  );
}
