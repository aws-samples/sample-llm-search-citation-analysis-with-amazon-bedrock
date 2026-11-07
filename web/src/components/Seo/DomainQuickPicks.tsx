/**
 * The Brand Tracking domains under a lookup form: one chip per own or competitor domain (a click looks it up),
 * or a pointer to Settings › Brand Tracking when the brand has no own domain there.
 */
import { SettingsHint } from './SettingsHint';
import type { DomainPick } from './settingsDomains';

export function DomainQuickPicks({
  picks, onPick
}: {
  readonly picks: readonly DomainPick[];
  readonly onPick: (domain: string) => void;
}) {
  if (picks.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Your and competitor domains">
      <span className="text-xs text-gray-500 dark:text-gray-400">Quick pick:</span>
      {picks.map((pick) => (
        <button
          key={pick.domain}
          type="button"
          onClick={() => onPick(pick.domain)}
          title={pick.competitor === null ? 'Your domain' : `Competitor: ${pick.competitor}`}
          className={`px-2 py-1 rounded-full text-xs border ${pick.role === 'owned'
            ? 'border-emerald-300 text-emerald-800 bg-emerald-50'
            : 'border-amber-300 text-amber-800 bg-amber-50'}`}
        >
          {pick.domain}
        </button>
      ))}
    </div>
  );
}

/** Shown near the input when Brand Tracking has no own domain to start from. */
export function NoOwnDomainHint() {
  return (
    <SettingsHint section="brand-config">
      Add the brand&apos;s own domain in Brand Tracking to open this page on it.
    </SettingsHint>
  );
}
