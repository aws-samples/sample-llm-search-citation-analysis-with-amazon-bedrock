import type { ReactNode } from 'react';

/**
 * Visual tone of the stat card icon badge.
 *
 * The set of tones is intentionally small and matches the design system
 * accent palette (see `docs/design-system.md`). Each tone resolves to a
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
}

const toneClasses: Record<StatCardTone, {
  bg: string;
  text: string;
  border: string;
}> = {
  blue: {
    bg: 'bg-blue-50',
    text: 'text-blue-600',
    border: 'border-blue-100',
  },
  violet: {
    bg: 'bg-violet-50',
    text: 'text-violet-600',
    border: 'border-violet-100',
  },
  emerald: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-600',
    border: 'border-emerald-100',
  },
  amber: {
    bg: 'bg-amber-50',
    text: 'text-amber-600',
    border: 'border-amber-100',
  },
  gray: {
    bg: 'bg-gray-50',
    text: 'text-gray-500',
    border: 'border-gray-100',
  },
};

export const StatCard = ({
  title, value, icon, tone = 'gray',
}: StatCardProps) => {
  const colors = toneClasses[tone];

  return (
    <div className={`bg-white rounded-lg border ${colors.border} p-6`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-gray-500 text-sm mb-1">{title}</p>
          <p className="text-3xl font-semibold text-gray-900">{value.toLocaleString()}</p>
        </div>
        <div className={`${colors.bg} ${colors.text} p-3 rounded-xl`}>
          {icon}
        </div>
      </div>
    </div>
  );
};
