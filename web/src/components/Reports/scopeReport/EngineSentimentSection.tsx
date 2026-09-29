import { useMemo } from 'react';
import type { EngineKpis } from '../../../types';
import {
  engineName, SentimentSplitChart, type SentimentRow
} from '../charts';
import type { ScopeSectionProps } from './scopeSectionGate';
import { LatestRunSection } from './ScopeSections';

/** One sentiment row per AI engine, labelled with the engine's name. */
export function engineSentimentRows(engines: readonly EngineKpis[]): SentimentRow[] {
  return engines.map((engine) => ({
    label: engineName(engine.engine),
    split: engine.kpis.sentiment_split,
  }));
}

/** How each AI engine words the mentions of your brand, stacked to 100% of its labelled mentions. */
export function EngineSentimentSection({ report }: ScopeSectionProps) {
  const engines = report.visibility.data?.engines;
  const rows = useMemo(() => engineSentimentRows(engines ?? []), [engines]);

  return (
    <LatestRunSection
      report={report}
      title="Sentiment per engine"
      subtitle="Each AI engine's mentions of your brand in its latest runs, by sentiment: positive, neutral, mixed and negative."
    >
      {() => <SentimentSplitChart rows={rows} />}
    </LatestRunSection>
  );
}
