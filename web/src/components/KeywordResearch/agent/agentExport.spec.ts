import {
  describe, expect, it
} from 'vitest';
import {
  briefExcelRows, proposalExcelRows, traceExcelRows
} from './agentExport';
import { buildAgentJob } from './agent-fixtures';

describe('proposalExcelRows', () => {
  it('ranks keywords in table order with their dimension label and sources', () => {
    const rows = proposalExcelRows(buildAgentJob().keywords ?? []);

    expect(rows[0]).toStrictEqual({
      Rank: 1,
      Keyword: 'hotel coruña centro',
      Dimension: 'Destination',
      Intent: 'transactional',
      Competition: 'high',
      Relevance: 9,
      Rationale: 'core demand',
      Sources: 'perplexity',
    });
    expect(rows[1].Sources).toBe('perplexity, serpapi');
  });

  it('labels an unknown dimension as Other', () => {
    const rows = proposalExcelRows(buildAgentJob().keywords ?? []);

    expect(rows[2].Dimension).toBe('Other');
  });
});

describe('traceExcelRows', () => {
  it('writes one row per planned query with the round evaluation', () => {
    const rows = traceExcelRows(buildAgentJob());

    expect(rows).toHaveLength(3);
    expect(rows[0]).toStrictEqual({
      Round: 1,
      Strategy: 'Destination first',
      Dimension: 'Destination',
      Query: 'hoteles coruña centro',
      Rationale: 'core',
      Decision: 'continue',
      'Evaluation reason': 'more to find',
      'Candidates after round': 30,
    });
    expect(rows[2].Decision).toBe('stop');
  });

  it('is empty for a run that never planned a round', () => {
    expect(traceExcelRows(buildAgentJob({ rounds: [] }))).toStrictEqual([]);
  });
});

describe('briefExcelRows', () => {
  it('summarises the brief and the outcome in one row', () => {
    const [row] = briefExcelRows(buildAgentJob());

    expect(row.Hotel).toBe('Hotel Gran Marino');
    expect(row.Dimensions).toBe('Destination, Audience');
    expect(row['Selection by']).toBe('model');
    expect(row.Candidates).toBe(41);
  });
});
