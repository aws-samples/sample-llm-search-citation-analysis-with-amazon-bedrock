import type { ReactNode } from 'react';

interface SettingsSectionHeaderProps {
  readonly title: string;
  readonly description: ReactNode;
  /** Header actions on the right (refresh, invite). */
  readonly children: ReactNode;
}

/** Title, one-line description and actions at the top of a settings tab. */
export const SettingsSectionHeader = ({
  title, description, children
}: SettingsSectionHeaderProps) => (
  // Same scale as the Keywords, Personas and Alerts headers (design system §3, section title).
  <div className="flex items-start justify-between gap-4">
    <div className="min-w-0">
      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      <p className="text-sm text-gray-500 mt-1">{description}</p>
    </div>
    <div className="flex shrink-0 items-center gap-2">{children}</div>
  </div>
);
