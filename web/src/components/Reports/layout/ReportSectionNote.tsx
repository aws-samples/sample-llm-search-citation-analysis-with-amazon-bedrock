import type { ReactNode } from 'react';
import { ReportSection } from './ReportSection';

interface Props {
  readonly title: string;
  /** Why the section has nothing to list. */
  readonly subtitle: string;
  /** What the reader can do about it, or what it means. */
  readonly children: ReactNode;
}

/**
 * A section that loaded but has nothing to list: its heading, why, and a
 * sentence of advice, so the printed report still says what was checked.
 */
export function ReportSectionNote({
  title, subtitle, children
}: Props) {
  return (
    <ReportSection title={title} subtitle={subtitle}>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        {children}
      </p>
    </ReportSection>
  );
}
