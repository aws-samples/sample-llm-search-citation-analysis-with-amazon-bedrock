import type { ReactNode } from 'react';

/**
 * Visual tone of the stat card icon badge.
 *
 * The set of tones is intentionally small and matches the design system
 * accent palette (see `docs/design-system.md`); dark mode shows every tone in neutral grey. Each tone resolves to a
 * tinted background and matching foreground colour for the icon container.
 */
type StatCardTone = 'blue' | 'violet' | 'emerald' | 'amber' | 'gray';

interface StatCardProps {
  readonly title: string;
  readonly value: number;
  /** Icon component instance (e.g. `<SearchIcon />`). */
  readonly icon: ReactNode;
  /** Accent tone applied to the icon badge. Defaults to `gray`. */
  readonly tone?: StatCardTone;
  /** The value is an estimate: shown as "≈ value" with an explanation. */
  readonly approximate?: boolean;
}

/** Why a total may be an estimate, as the tooltip and screen readers say it. */
export const APPROXIMATE_COUNT_NOTE = 'Approximate count: large tables are counted from a total refreshed every few hours.';

const NEUTRAL_TONE = {
  bg: 'bg-gray-100 dark:bg-gray-700/60',
  text: 'text-gray-600 dark:text-gray-300',
  border: 'border-gray-200 dark:border-gray-700',
};

/** Every tone renders the same neutral badge (design-system §2.2); the tones stay so callers keep their intent. */
const toneClasses: Record<StatCardTone, {
  bg: string;
  text: string;
  border: string;
}> = {
  blue: NEUTRAL_TONE,
  violet: NEUTRAL_TONE,
  emerald: NEUTRAL_TONE,
  amber: NEUTRAL_TONE,
  gray: NEUTRAL_TONE,
};

export const StatCard = ({
  title, value, icon, tone = 'gray', approximate = false,
}: StatCardProps) => {
  const colors = toneClasses[tone];

  return (
    <div className={`bg-white rounded-lg border ${colors.border} p-6`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-gray-500 text-sm mb-1">{title}</p>
          <p className="text-3xl font-semibold text-gray-900" title={approximate ? APPROXIMATE_COUNT_NOTE : undefined}>
            {approximate && <span aria-hidden="true">≈ </span>}
            {approximate && <span className="sr-only">{`${APPROXIMATE_COUNT_NOTE} `}</span>}
            {value.toLocaleString()}
          </p>
        </div>
        <div className={`${colors.bg} ${colors.text} p-3 rounded-xl`}>
          {icon}
        </div>
      </div>
    </div>
  );
};
