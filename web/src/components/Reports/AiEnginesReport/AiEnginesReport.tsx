import type { Keyword } from '../../../types';
import {
  EngineSentimentSection, ScopeReport, type ScopeSectionProps
} from '../scopeReport';
import { EngineHeadlineSection } from './sections/EngineHeadlineSection';
import { EngineChartSection } from './sections/EngineChartSection';
import { EngineTableSection } from './sections/EngineTableSection';

const ENGINES_PATH = '/reports/engines';

/** The sections of the AI Engines report, in order. */
export function EngineSections({ report }: ScopeSectionProps) {
  return (
    <>
      <EngineHeadlineSection report={report} />
      <EngineChartSection report={report} />
      <EngineTableSection report={report} />
      <EngineSentimentSection report={report} />
    </>
  );
}

function enginesSubtitle(scopeLabel: string): string {
  return `How each AI engine answers for "${scopeLabel}": which engines name your brand, every KPI per engine and how each words it.`;
}

interface Props {readonly keywords: ReadonlyArray<Keyword>;}

/**
 * AI Engines (`/reports/engines`): engine coverage, the main KPIs per
 * engine as grouped bars, every KPI per engine in a table, and each
 * engine's sentiment split.
 */
export function AiEnginesReport({ keywords }: Props) {
  return (
    <ScopeReport title="AI Engines" basePath={ENGINES_PATH} keywords={keywords} subtitle={enginesSubtitle}>
      {(report) => <EngineSections report={report} />}
    </ScopeReport>
  );
}
