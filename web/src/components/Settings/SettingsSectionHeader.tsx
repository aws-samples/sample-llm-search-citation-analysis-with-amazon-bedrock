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
  <div className="flex items-center justify-between">
    <div>
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <p className="text-xs text-gray-500 mt-1">{description}</p>
    </div>
    {children}
  </div>
);
