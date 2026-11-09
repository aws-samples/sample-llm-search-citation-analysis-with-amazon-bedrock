import type { ReactNode } from 'react';

interface ScheduleSwitchProps {
  /** Id and name of the checkbox, for a form field; omit in a list row. */
  readonly id?: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  /** Accessible name when the visible text does not name the switch on its own. */
  readonly ariaLabel?: string;
  /** Visible text beside the track. */
  readonly children: ReactNode;
}

/**
 * An on/off switch for a schedule: a native checkbox with `role="switch"`, so
 * it keeps its form identity and keyboard behaviour, drawn as a track and a
 * knob. On is blue, the interaction colour (`docs/design-system.md` §2.2).
 */
export const ScheduleSwitch = ({
  id, checked, onChange, disabled = false, ariaLabel, children
}: ScheduleSwitchProps) => (
  <label htmlFor={id} className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer has-[:disabled]:cursor-not-allowed">
    <span className="relative inline-flex shrink-0">
      <input
        id={id}
        name={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="h-5 w-9 rounded-full bg-gray-300 dark:bg-gray-500 transition-colors peer-checked:bg-blue-600 peer-disabled:opacity-50 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-600 peer-focus-visible:ring-offset-2 dark:peer-focus-visible:ring-offset-gray-800"
      />
      <span
        aria-hidden="true"
        className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-zinc-50 shadow-sm transition-transform peer-checked:translate-x-4"
      />
    </span>
    {children}
  </label>
);
