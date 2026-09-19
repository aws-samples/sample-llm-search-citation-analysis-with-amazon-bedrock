import { ReportSection } from './ReportSection';
import { SectionPlaceholder } from './SectionPlaceholder';

interface Props {
  readonly title: string;
  readonly subtitle?: string;
  readonly variant: 'loading' | 'error' | 'empty';
  readonly message: string;
}

/**
 * A whole report section reduced to a single placeholder message — the
 * shape every section takes while loading, after an error, or when the
 * data source has nothing to show. Keeping the heading in place means the
 * printed report still lists the section even when it is empty.
 */
export function ReportSectionPlaceholder({
  title,
  subtitle,
  variant,
  message,
}: Props) {
  return (
    <ReportSection title={title} subtitle={subtitle}>
      <SectionPlaceholder variant={variant} message={message} />
    </ReportSection>
  );
}
