/**
 * The Brand Tracking domains under a lookup form: one chip per own or competitor domain (a click looks it up),
 * or a pointer to Settings › Brand Tracking when the brand has no own domain there.
 */
import { SettingsHint } from './SettingsHint';
import type { DomainPick } from './settingsDomains';

const CHIP_CLASSES: Record<DomainPick['role'], string> = {
  owned: 'border-violet-300 text-violet-800 bg-violet-50',
  competitor: 'border-gray-300 text-amber-800 bg-gray-50',
};

interface QuickPicksProps {
  readonly picks: readonly DomainPick[];
  /** Looks the domain up at once (a paid call). */
  readonly onPick: (domain: string) => void;
}

/** One labelled row of chips ("Your domains:", "Competitors:"), so the chip colour is never the only cue. */
function PickRow({
  label, picks, onPick
}: QuickPicksProps & { readonly label: string }) {
  if (picks.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      {picks.map((pick) => (
        <button
          key={pick.domain}
          type="button"
          onClick={() => onPick(pick.domain)}
          title={pick.competitor === null ? 'Your domain' : `Competitor: ${pick.competitor}`}
          className={`px-2 py-1 rounded-full text-xs border focus:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-900 dark:focus-visible:ring-gray-300 ${CHIP_CLASSES[pick.role]}`}
        >
          {pick.domain}
        </button>
      ))}
    </div>
  );
}

export function DomainQuickPicks({
  picks, onPick
}: QuickPicksProps) {
  if (picks.length === 0) return null;
  return (
    <div className="space-y-2" aria-label="Your and competitor domains">
      <PickRow label="Your domains:" picks={picks.filter((pick) => pick.role === 'owned')} onPick={onPick} />
      <PickRow label="Competitors:" picks={picks.filter((pick) => pick.role === 'competitor')} onPick={onPick} />
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
