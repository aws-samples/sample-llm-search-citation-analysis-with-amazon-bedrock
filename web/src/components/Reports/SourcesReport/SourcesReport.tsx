import type { Keyword } from '../../../types';
import {
  ScopeReport, type ScopeSectionProps
} from '../scopeReport';
import { SourcesHeadlineSection } from './sections/SourcesHeadlineSection';
import { TopSourcesSection } from './sections/TopSourcesSection';
import { DomainsTableSection } from './sections/DomainsTableSection';

const SOURCES_PATH = '/reports/sources';

/** The sections of the Sources report, in order. */
export function SourcesSections({ report }: ScopeSectionProps) {
  return (
    <>
      <SourcesHeadlineSection report={report} />
      <TopSourcesSection report={report} />
      <DomainsTableSection report={report} />
    </>
  );
}

function sourcesSubtitle(scopeLabel: string): string {
  return `Which websites the AI answers cite as sources for "${scopeLabel}", and how often they cite yours.`;
}

interface Props {readonly keywords: ReadonlyArray<Keyword>;}

/**
 * Sources (`/reports/sources`): the citation KPIs, the most cited domains
 * as bars with your owned domains highlighted, and every cited domain in a
 * table, with a pointer to Citation Gaps for the gap analysis.
 */
export function SourcesReport({ keywords }: Props) {
  return (
    <ScopeReport title="Sources" basePath={SOURCES_PATH} keywords={keywords} subtitle={sourcesSubtitle}>
      {(report) => <SourcesSections report={report} />}
    </ScopeReport>
  );
}
