import { exportWorkbook } from '../../../exporters/excelGenerator';
import type {
  KeywordResearchItem, ResearchKeyword
} from '../../../types';
import { researchExcelFileName } from '../researchExport';
import { dimensionLabel } from './agentBrief';

/** Proposal sheet rows, grouped the way the review table shows them. */
export function proposalExcelRows(keywords: ResearchKeyword[]): Record<string, unknown>[] {
  return keywords.map((keyword, index) => ({
    Rank: index + 1,
    Keyword: keyword.keyword,
    Dimension: dimensionLabel(keyword.dimension),
    Intent: keyword.intent ?? '',
    Competition: keyword.competition ?? '',
    Relevance: keyword.relevance ?? '',
    Rationale: keyword.rationale ?? '',
    Sources: (keyword.providers ?? []).join(', '),
  }));
}

/** One row per planned query with the round's evaluation, for the Trace sheet. */
export function traceExcelRows(job: KeywordResearchItem): Record<string, unknown>[] {
  return (job.rounds ?? []).flatMap((round) => round.queries.map((query) => ({
    Round: round.round,
    Strategy: round.strategy,
    Dimension: dimensionLabel(query.dimension),
    Query: query.query,
    Rationale: query.rationale,
    Decision: round.evaluation?.decision ?? '',
    'Evaluation reason': round.evaluation?.reason ?? '',
    'Candidates after round': round.evaluation?.candidate_count ?? '',
  })));
}

export function briefExcelRows(job: KeywordResearchItem): Record<string, unknown>[] {
  const config = job.config;
  return [{
    Hotel: config?.seed ?? job.seed_keyword ?? '',
    Country: config?.country ?? '',
    Language: config?.language ?? '',
    Dimensions: (config?.dimensions ?? []).map(dimensionLabel).join(', '),
    Instruction: config?.instruction ?? '',
    'Target keywords': config?.target_count ?? '',
    'Max rounds': config?.max_rounds ?? '',
    Template: job.template_name ?? '',
    Status: job.status ?? '',
    Candidates: job.candidates_count ?? '',
    Proposed: job.keyword_count,
    'Selection by': job.proposal_source ?? '',
    Started: job.created_at,
    Finished: job.finished_at ?? '',
  }];
}

export async function exportAgentRun(job: KeywordResearchItem, keywords: ResearchKeyword[]): Promise<void> {
  const title = `agent-${job.config?.seed ?? job.seed_keyword ?? job.id}`;
  await exportWorkbook([
    {
      name: 'Proposal',
      data: proposalExcelRows(keywords),
      columns: [{ wch: 6 }, { wch: 45 }, { wch: 22 }, { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 60 }, { wch: 28 }],
    },
    {
      name: 'Trace',
      data: traceExcelRows(job),
      columns: [{ wch: 7 }, { wch: 40 }, { wch: 22 }, { wch: 45 }, { wch: 45 }, { wch: 10 }, { wch: 45 }, { wch: 12 }],
    },
    {
      name: 'Brief',
      data: briefExcelRows(job),
      columns: [{ wch: 28 }, { wch: 8 }, { wch: 8 }, { wch: 45 }, { wch: 45 }, { wch: 10 }, { wch: 10 }, { wch: 28 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 22 }, { wch: 22 }],
    },
  ], researchExcelFileName(title));
}
