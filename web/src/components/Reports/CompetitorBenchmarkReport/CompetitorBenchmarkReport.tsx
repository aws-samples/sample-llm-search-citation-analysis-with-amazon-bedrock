import type { Keyword } from '../../../types';
import {
  ScopeReport, type ScopeSectionProps
} from '../scopeReport';
import { BenchmarkHeadlineSection } from './sections/BenchmarkHeadlineSection';
import { ShareOfVoiceSection } from './sections/ShareOfVoiceSection';
import { BrandTrendSection } from './sections/BrandTrendSection';
import { LeaderboardSection } from './sections/LeaderboardSection';

const BENCHMARK_PATH = '/reports/benchmark';

/** The sections of the Competitor Benchmark, in order. */
export function BenchmarkSections({ report }: ScopeSectionProps) {
  return (
    <>
      <BenchmarkHeadlineSection report={report} />
      <ShareOfVoiceSection report={report} />
      <BrandTrendSection report={report} />
      <LeaderboardSection report={report} />
    </>
  );
}

function benchmarkSubtitle(scopeLabel: string): string {
  return `How your brand compares with every brand the AI answers name for "${scopeLabel}": share of voice now and over time, and every KPI per brand.`;
}

interface Props {readonly keywords: ReadonlyArray<Keyword>;}

/**
 * Competitor Benchmark (`/reports/benchmark`): your share of voice and rank
 * against every brand the answers name, the share of voice as a donut, the
 * leading brands over time, and the full leaderboard with every KPI.
 */
export function CompetitorBenchmarkReport({ keywords }: Props) {
  return (
    <ScopeReport title="Competitor Benchmark" basePath={BENCHMARK_PATH} keywords={keywords} subtitle={benchmarkSubtitle}>
      {(report) => <BenchmarkSections report={report} />}
    </ScopeReport>
  );
}
