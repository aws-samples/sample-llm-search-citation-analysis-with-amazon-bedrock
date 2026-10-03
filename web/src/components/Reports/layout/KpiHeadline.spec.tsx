import {
  describe, expect, it
} from 'vitest';
import {
  HEADLINE_KPIS, OWNED_DOMAINS_MISSING, trendAccent
} from './KpiHeadline';
import {
  COMPARISON_LABEL, dayFootnote, HEADLINE_LABELS, itAsksForOwnedDomains, itShowsHeadlineCards, itShowsKpiTable, itShowsNoComparison,
  NO_COMPARISON_NOTE, renderKpiHeadline
} from './kpiHeadline-fixtures';
import {
  headlineCardLabels, sectionTable, statFigure, statFootnote
} from './reportQueries-fixtures';
import { KPI_DEFINITIONS } from '../../../constants/kpiDefinitions';
import {
  buildKpis, buildTrends, GROUP_DELTAS, unknownKpis
} from '../BrandVisibilityReport/groupKpiHistory-fixtures';

describe('KpiHeadline cards', () => {
  it('shows a card for each headline KPI, in the order of HEADLINE_KPIS', () => {
    renderKpiHeadline();

    expect(headlineCardLabels()).toStrictEqual(HEADLINE_KPIS.map((id) => KPI_DEFINITIONS[id].label));
  });

  itShowsHeadlineCards(renderKpiHeadline, dayFootnote);

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

    expect(statFootnote('Share of voice')).toBe(dayFootnote('—'));
  });
});

describe('KpiHeadline without a comparison', () => {
  itShowsNoComparison(() => renderKpiHeadline({ comparison: null }), NO_COMPARISON_NOTE);
});

describe('KpiHeadline without owned domains', () => {
  itAsksForOwnedDomains(() => renderKpiHeadline({ citationsConfigured: false }), dayFootnote);

  it('asks for owned domains under the citation rate even with nothing to compare with', () => {
    renderKpiHeadline({
      comparison: null,
      citationsConfigured: false,
    });

    expect(statFootnote('Citation rate')).toBe(OWNED_DOMAINS_MISSING);
  });
});

describe('KpiHeadline KPI table', () => {
  itShowsKpiTable(renderKpiHeadline);

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
