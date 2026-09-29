import {
  describe, expect, it
} from 'vitest';
import { within } from '@testing-library/react';
import {
  HEADLINE_KPIS, OWNED_DOMAINS_MISSING, trendAccent
} from './KpiHeadline';
import {
  COMPARISON_LABEL, HEADLINE_CARDS, HEADLINE_LABELS, KPI_TABLE_ROWS, NO_COMPARISON_NOTE, renderKpiHeadline
} from './kpiHeadline-fixtures';
import {
  headlineCardLabels, kpiRowTooltips, sectionTable, statCard, statFigure, statFootnote
} from './reportQueries-fixtures';
import {
  KPI_DEFINITIONS, KPI_SPECS
} from '../../../constants/kpiDefinitions';
import {
  buildKpis, buildTrends, GROUP_DELTAS, unknownKpis
} from '../BrandVisibilityReport/groupKpiHistory-fixtures';

describe('KpiHeadline cards', () => {
  it('shows a card for each headline KPI, in the order of HEADLINE_KPIS', () => {
    renderKpiHeadline();

    expect(headlineCardLabels()).toStrictEqual(HEADLINE_KPIS.map((id) => KPI_DEFINITIONS[id].label));
  });

  it.each(HEADLINE_CARDS)('shows the %s value as %s', (_id, label, value) => {
    renderKpiHeadline();

    expect(statFigure(label).textContent).toBe(value);
  });

  it.each(HEADLINE_CARDS)('writes the %s change followed by what it compares with', (_id, label, _value, change) => {
    renderKpiHeadline();

    expect(statFootnote(label)).toBe(`${change} ${COMPARISON_LABEL}`);
  });

  it.each(HEADLINE_CARDS)('colours the %s figure by its trend', (_id, label, _value, _change, colour) => {
    renderKpiHeadline();

    expect(statFigure(label)).toHaveClass(colour);
  });

  it.each(HEADLINE_CARDS)('explains in the card tooltip how %s is measured', (id, label) => {
    renderKpiHeadline();

    expect(within(statCard(label)).getByRole('button')).toHaveAccessibleDescription(KPI_DEFINITIONS[id].definition);
  });

  it('shows an unknown KPI as a dash on its card', () => {
    renderKpiHeadline({ kpis: unknownKpis() });

    expect(HEADLINE_LABELS.map((label) => statFigure(label).textContent)).toStrictEqual(['—', '—', '—', '—']);
  });

  it('writes an unknown change as a dash before what it compares with', () => {
    renderKpiHeadline({
      comparison: {
        deltas: {
          ...GROUP_DELTAS,
          share_of_voice: null 
        },
        trends: buildTrends(),
        label: COMPARISON_LABEL,
      },
    });

    expect(statFootnote('Share of voice')).toBe(`— ${COMPARISON_LABEL}`);
  });
});

describe('KpiHeadline without a comparison', () => {
  it('writes the no-comparison note under every card', () => {
    renderKpiHeadline({ comparison: null });

    expect(HEADLINE_LABELS.map(statFootnote)).toStrictEqual(HEADLINE_LABELS.map(() => NO_COMPARISON_NOTE));
  });

  it('colours every card neutral', () => {
    renderKpiHeadline({ comparison: null });

    expect(HEADLINE_LABELS.map((label) => statFigure(label).classList.contains('text-gray-900'))).toStrictEqual([true, true, true, true]);
  });

  it('shows no change and no trend for any KPI of the table', () => {
    renderKpiHeadline({ comparison: null });

    expect(new Set(sectionTable('Headline').slice(1).flatMap((row) => row.slice(2)))).toStrictEqual(new Set(['—']));
  });
});

describe('KpiHeadline without owned domains', () => {
  it('asks for owned domains under the citation rate instead of its change', () => {
    renderKpiHeadline({ citationsConfigured: false });

    expect(statFootnote('Citation rate')).toBe(OWNED_DOMAINS_MISSING);
  });

  it('asks for owned domains under the citation rate even with nothing to compare with', () => {
    renderKpiHeadline({
      comparison: null,
      citationsConfigured: false,
    });

    expect(statFootnote('Citation rate')).toBe(OWNED_DOMAINS_MISSING);
  });

  it('keeps the change under the other cards', () => {
    renderKpiHeadline({ citationsConfigured: false });

    expect(statFootnote('Mention rate')).toBe(`-10.0 pts ${COMPARISON_LABEL}`);
  });
});

describe('KpiHeadline KPI table', () => {
  it('heads the table with the KPI, its value, change and trend', () => {
    renderKpiHeadline();

    expect(sectionTable('Headline')[0]).toStrictEqual(['KPI', 'Value', 'Change', 'Trend']);
  });

  it('lists every KPI in report order with its value, change and trend', () => {
    renderKpiHeadline();

    expect(sectionTable('Headline').slice(1)).toStrictEqual(KPI_TABLE_ROWS);
  });

  it('explains every KPI row in a tooltip holding its definition', () => {
    renderKpiHeadline();

    expect(kpiRowTooltips()).toStrictEqual(KPI_SPECS.map((spec) => [`About ${spec.label}`, spec.definition]));
  });

  it('shows no trend for a KPI the comparison does not judge', () => {
    renderKpiHeadline({
      kpis: buildKpis(),
      comparison: {
        deltas: GROUP_DELTAS,
        trends: {},
        label: COMPARISON_LABEL,
      },
    });

    expect(sectionTable('Headline')[3]).toStrictEqual(['Mention rate', '60.0%', '-10.0 pts', '—']);
  });
});

describe('trendAccent', () => {
  it.each([
    ['improving', 'positive'],
    ['declining', 'negative'],
    ['stable', 'neutral'],
    [undefined, 'neutral'],
  ] as const)('colours a %s trend %s', (trend, accent) => {
    expect(trendAccent(trend)).toBe(accent);
  });
});
