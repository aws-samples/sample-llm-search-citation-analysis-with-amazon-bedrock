import {
  describe, expect, it
} from 'vitest';
import {
  briefExcelRows, proposalExcelRows, traceExcelRows
} from './agentExport';
import {
  CAFE_DIMENSIONS, HOTEL_DIMENSIONS, buildAgentJob, buildAgentKeyword
} from './agent-fixtures';

describe('proposalExcelRows', () => {
  it('ranks keywords in table order with their catalogue label and sources', () => {
    const rows = proposalExcelRows(buildAgentJob().keywords ?? [], HOTEL_DIMENSIONS);

    expect(rows[0]).toStrictEqual({
      Rank: 1,
      Keyword: 'hotel coruña centro',
      Dimension: 'Destination',
      Tracking: 'Recommended',
      'Tracking score': 904,
      'Tracking reason': 'Relevance 9/10; transactional intent; 1 provider.',
      Intent: 'transactional',
      Competition: 'high',
      Relevance: 9,
      Rationale: 'core demand',
      Sources: 'perplexity',
    });
    expect(rows[1].Sources).toBe('perplexity, serpapi');
  });

  it('exports unselected recommendations as library terms with their explanation', () => {
    const rows = proposalExcelRows(buildAgentJob().keywords ?? [], HOTEL_DIMENSIONS);

    expect(rows[2].Tracking).toBe('Library');
    expect(rows[2]['Tracking score']).toBe(602);
    expect(rows[2]['Tracking reason']).toBe('Relevance 6/10; informational intent; 1 provider.');
  });

  it('labels a dimension the catalogue does not know as Other', () => {
    const rows = proposalExcelRows(buildAgentJob().keywords ?? [], HOTEL_DIMENSIONS);

    expect(rows[2].Dimension).toBe('Other');
  });

  it('labels the same id with the wording of the catalogue it is given', () => {
    const rows = proposalExcelRows([buildAgentKeyword({ dimension: 'location' })], CAFE_DIMENSIONS);

    expect(rows[0].Dimension).toBe('Location');
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

  it('labels the queries through the run catalogue', () => {
    const job = buildAgentJob();
    const rows = traceExcelRows({
      ...job,
      config: job.config && {
        ...job.config,
        dimension_catalog: [{
          id: 'destination',
          label: 'Ciudad',
          description: '',
        }],
      },
    });

    expect(rows.map((row) => row.Dimension)).toStrictEqual(['Ciudad', 'Other', 'Other']);
  });

  it('is empty for a run that never planned a round', () => {
    expect(traceExcelRows(buildAgentJob({ rounds: [] }))).toStrictEqual([]);
  });
});

describe('briefExcelRows', () => {
  it('summarises the brief, the profile and the outcome in one row', () => {
    const [row] = briefExcelRows(buildAgentJob());

    expect(row.Business).toBe('Hotel Gran Marino');
    expect(row.Subject).toBe('hotel');
    expect(row.Dimensions).toBe('Destination, Audience');
    expect(row.Candidates).toBe(41);
  });

  it('records the tracking brief without claiming measured volume', () => {
    const [row] = briefExcelRows(buildAgentJob());

    expect(row['Configured tracking keywords']).toBe(2);
    expect(row['Actual tracking keywords']).toBe(2);
    expect(row['Tracking interpretation']).toBe('Demand proxy based on available signals; not measured search volume.');
  });

  it('records who the run was for and how the list was selected', () => {
    const [row] = briefExcelRows(buildAgentJob());

    expect(row.Audience).toBe('travellers');
    expect(row['Selection by']).toBe('model');
  });
});
