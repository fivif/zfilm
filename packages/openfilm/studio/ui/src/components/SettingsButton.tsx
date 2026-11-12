/**
 * Settings, and the only button the titlebar's left corner has: a cog drawn in the app's own colours rather than a
 * stock icon. The outline is sampled from a smooth wave (eight teeth, rounded flanks, a hole punched through the hub),
 * which is the one silhouette that still reads as a gear at 19 px — square teeth read as petals there. The sweep runs
 * cyan → indigo → violet → rose across it, a halo lifts it off the titlebar, and a gloss catches the upper left; it
 * turns a notch on hover. The gradient is named after this instance, so two of them never share one.
 */
import React from 'react';
import { useT } from '@/i18n';

const CENTRE = 12;
const TEETH = 8;
const OUTER = 10.3;
const ROOT = 7.15;
const HOLE = 3.15;

/** The cog's outline: a radius that swells to a tooth and settles between two, sampled round; the hole wound the other way. */
function cogPath() {
  const outer = [];
  const STEPS = 128;
  for (let i = 0; i < STEPS; i++) {
    const angle = (i / STEPS) * Math.PI * 2;
    const wave = 0.5 + 0.5 * Math.cos(TEETH * angle);
    const radius = ROOT + (OUTER - ROOT) * wave ** 2.1;
    outer.push(`${i === 0 ? 'M' : 'L'}${(CENTRE + Math.cos(angle) * radius).toFixed(2)} ${(CENTRE + Math.sin(angle) * radius).toFixed(2)}`);
  }
  outer.push('Z');
  const hole = [];
  const HOLE_STEPS = 48;
  for (let i = 0; i <= HOLE_STEPS; i++) {
    const angle = -(i / HOLE_STEPS) * Math.PI * 2;
    hole.push(`${i === 0 ? 'M' : 'L'}${(CENTRE + Math.cos(angle) * HOLE).toFixed(2)} ${(CENTRE + Math.sin(angle) * HOLE).toFixed(2)}`);
  }
  hole.push('Z');
  return `${outer.join('')}${hole.join('')}`;
}

const COG = cogPath();

export function SettingsButton({ onSettings, className = '' }: { onSettings: () => void; className?: string }) {
  const t = useT();
  const key = React.useId().replace(/[:]/g, '');
  const sweep = `of-gear-sweep-${key}`;
  const halo = `of-gear-halo-${key}`;
  const gloss = `of-gear-gloss-${key}`;
  return (
    <button type="button" aria-label={t('settings.title')} onClick={onSettings}
      className={`group flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md outline-none transition hover:bg-[var(--bg-hover)] focus-visible:ring-1 focus-visible:ring-[var(--accent)] ${className}`}>
      <svg viewBox="0 0 24 24" width="20" height="20" className="block overflow-visible transition-transform duration-700 ease-out group-hover:rotate-[360deg] motion-reduce:transition-none motion-reduce:group-hover:rotate-0" aria-hidden focusable="false">
        <defs>
          <linearGradient id={sweep} x1="2.5" y1="2" x2="21.5" y2="22" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#22d3ee" />
            <stop offset="0.38" stopColor="#818cf8" />
            <stop offset="0.72" stopColor="#c084fc" />
            <stop offset="0.92" stopColor="#f472b6" />
            <stop offset="1" stopColor="#fb7185" />
          </linearGradient>
          <radialGradient id={halo} cx="12" cy="12" r="10.6" gradientUnits="userSpaceOnUse">
            <stop offset="0.55" stopColor="#a78bfa" stopOpacity="0.28" />
            <stop offset="0.84" stopColor="#e879f9" stopOpacity="0.11" />
            <stop offset="1" stopColor="#e879f9" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={gloss} cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.5" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* a halo, so the mark glows against the titlebar instead of sitting flat on it */}
        <circle cx="12" cy="12" r="10.6" fill={`url(#${halo})`} />
        <path d={COG} fill={`url(#${sweep})`} fillRule="evenodd" />
        {/* the gloss: light on the upper left, as if the cog were glass */}
        <ellipse cx="9.4" cy="8.2" rx="3.9" ry="2.4" fill={`url(#${gloss})`} transform="rotate(-30 9.4 8.2)" />
      </svg>
    </button>
  );
}
