import { exportWorkbook } from '../../../exporters/excelGenerator';
import type {
  AgentConfig, AgentDimensionOption, KeywordResearchItem, ResearchKeyword
} from '../../../types';
import { researchExcelFileName } from '../researchExport';
import {
  AGENT_DEFAULT_TRACKING_COUNT, dimensionLabel, runCatalog
} from './agentBrief';

function trackingExportLabel(tracking: boolean | undefined): string {
  if (tracking === true) return 'Recommended';
  if (tracking === false) return 'Library';
  return '';
}

/** Proposal sheet rows, grouped the way the review table shows them; labels from the run's catalogue. */
export function proposalExcelRows(keywords: ResearchKeyword[], catalog: readonly AgentDimensionOption[]): Record<string, unknown>[] {
  return keywords.map((keyword, index) => ({
    Rank: index + 1,
    Keyword: keyword.keyword,
    Dimension: dimensionLabel(keyword.dimension, catalog),
    Tracking: trackingExportLabel(keyword.tracking),
    'Tracking score': keyword.tracking_score ?? '',
    'Tracking reason': keyword.tracking_reason ?? '',
    Intent: keyword.intent ?? '',
    Competition: keyword.competition ?? '',
    Relevance: keyword.relevance ?? '',
    Rationale: keyword.rationale ?? '',
    Sources: (keyword.providers ?? []).join(', '),
  }));
}

/** One row per planned query with the round's evaluation, for the Trace sheet. */
export function traceExcelRows(job: KeywordResearchItem): Record<string, unknown>[] {
  const catalog = runCatalog(job);
  return (job.rounds ?? []).flatMap((round) => round.queries.map((query) => ({
    Round: round.round,
    Strategy: round.strategy,
    Dimension: dimensionLabel(query.dimension, catalog),
    Query: query.query,
    Rationale: query.rationale,
    Decision: round.evaluation?.decision ?? '',
    'Evaluation reason': round.evaluation?.reason ?? '',
    'Candidates after round': round.evaluation?.candidate_count ?? '',
  })));
}

interface TrackingBriefCounts {
  configured: number | '';
  actual: number | '';
}

/** How many keywords the brief asked to track and how many the proposal marks as recommended. */
function trackingBriefCounts(job: KeywordResearchItem): TrackingBriefCounts {
  const config = job.config;
  const configured = config === undefined
    ? ''
    : config.tracking_count ?? Math.min(AGENT_DEFAULT_TRACKING_COUNT, config.target_count);
  const proposal = job.keywords ?? [];
  const marked = proposal.filter((keyword) => keyword.tracking === true).length;
  const hasMarks = proposal.some((keyword) => keyword.tracking !== undefined);
  return {
    configured,
    actual: job.tracking_count ?? (hasMarks ? marked : ''),
  };
}

const NO_CONFIG: Partial<AgentConfig> = {};

/** The brief the run was started with; rows written before the agent carry no config. */
function briefColumns(job: KeywordResearchItem): Record<string, unknown> {
  const config = job.config ?? NO_CONFIG;
  const catalog = runCatalog(job);
  const tracking = trackingBriefCounts(job);
  return {
    Business: config.seed ?? job.seed_keyword ?? '',
    Subject: config.subject ?? '',
    Audience: config.audience ?? '',
    Country: config.country ?? '',
    Language: config.language ?? '',
    Dimensions: (config.dimensions ?? []).map((dimension) => dimensionLabel(dimension, catalog)).join(', '),
    Instruction: config.instruction ?? '',
    'Target keywords': config.target_count ?? '',
    'Configured tracking keywords': tracking.configured,
    'Actual tracking keywords': tracking.actual,
    'Tracking interpretation': 'Demand proxy based on available signals; not measured search volume.',
    'Max rounds': config.max_rounds ?? '',
  };
}

/** What the run produced and how it went. */
function outcomeColumns(job: KeywordResearchItem): Record<string, unknown> {
  return {
    Template: job.template_name ?? '',
    Status: job.status ?? '',
    Candidates: job.candidates_count ?? '',
    Proposed: job.keyword_count,
    'Selection by': job.proposal_source ?? '',
    Started: job.created_at,
    Finished: job.finished_at ?? '',
  };
}

export function briefExcelRows(job: KeywordResearchItem): Record<string, unknown>[] {
  return [{
    ...briefColumns(job),
    ...outcomeColumns(job),
  }];
}

export async function exportAgentRun(job: KeywordResearchItem, keywords: ResearchKeyword[]): Promise<void> {
  const title = `agent-${job.config?.seed ?? job.seed_keyword ?? job.id}`;
  await exportWorkbook([
    {
      name: 'Proposal',
      data: proposalExcelRows(keywords, runCatalog(job)),
      columns: [
        { wch: 6 }, { wch: 45 }, { wch: 22 }, { wch: 16 }, { wch: 14 }, { wch: 60 },
        { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 60 }, { wch: 28 },
      ],
    },
    {
      name: 'Trace',
      data: traceExcelRows(job),
      columns: [{ wch: 7 }, { wch: 40 }, { wch: 22 }, { wch: 45 }, { wch: 45 }, { wch: 10 }, { wch: 45 }, { wch: 12 }],
    },
    {
      name: 'Brief',
      data: briefExcelRows(job),
      columns: [
        { wch: 28 }, { wch: 14 }, { wch: 18 }, { wch: 8 }, { wch: 8 }, { wch: 45 },
        { wch: 45 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 70 }, { wch: 10 },
        { wch: 28 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 22 }, { wch: 22 },
      ],
    },
  ], researchExcelFileName(title));
}
