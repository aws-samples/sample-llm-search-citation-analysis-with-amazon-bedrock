import type { Keyword } from '../../../types';
import {
  EngineSentimentSection, ScopeReport, type ScopeSectionProps
} from '../scopeReport';
import { SentimentHeadlineSection } from './sections/SentimentHeadlineSection';
import { NetSentimentTrendSection } from './sections/NetSentimentTrendSection';
import { BrandSentimentSection } from './sections/BrandSentimentSection';

export const SENTIMENT_PATH = '/reports/sentiment';

/** The sections of the Sentiment report, in order. */
export function SentimentSections({ report }: ScopeSectionProps) {
  return (
    <>
      <SentimentHeadlineSection report={report} />
      <NetSentimentTrendSection report={report} />
      <EngineSentimentSection report={report} />
      <BrandSentimentSection report={report} />
    </>
  );
}

function sentimentSubtitle(scopeLabel: string): string {
  return `How the AI answers word your brand for "${scopeLabel}": net sentiment now and over time, per engine and against every other brand.`;
}

interface Props {readonly keywords: ReadonlyArray<Keyword>;}

/**
 * Sentiment (`/reports/sentiment`): the net sentiment with its change and
 * split, its trend, the split per AI engine and the net sentiment of every
 * brand named.
 */
export function SentimentReport({ keywords }: Props) {
  return (
    <ScopeReport title="Sentiment" basePath={SENTIMENT_PATH} keywords={keywords} subtitle={sentimentSubtitle}>
      {(report) => <SentimentSections report={report} />}
    </ScopeReport>
  );
}
