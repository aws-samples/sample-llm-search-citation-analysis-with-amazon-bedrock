import {
  describe, expect, it
} from 'vitest';
import { definitionsSheet } from './kpiSheets';

const DEFINITIONS = [
  {
    label: 'Mention rate',
    definition: 'Share of answers that mention the brand.',
  },
  {
    label: 'Trend',
    definition: 'How a change is judged.',
  },
];

describe('definitionsSheet', () => {
  it('names the sheet Definitions', () => {
    expect(definitionsSheet(DEFINITIONS).name).toBe('Definitions');
  });

  it('writes one row per definition, in order, with the KPI and how it is measured', () => {
    expect(definitionsSheet(DEFINITIONS).data).toStrictEqual([
      {
        KPI: 'Mention rate',
        'How it is measured': 'Share of answers that mention the brand.',
      },
      {
        KPI: 'Trend',
        'How it is measured': 'How a change is judged.',
      },
    ]);
  });

  it('writes no rows when there is nothing to define', () => {
    expect(definitionsSheet([]).data).toStrictEqual([]);
  });

  it('gives both columns a width', () => {
    expect(definitionsSheet(DEFINITIONS).columns).toHaveLength(2);
  });
});
