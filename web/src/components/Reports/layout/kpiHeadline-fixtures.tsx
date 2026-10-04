import {
  expect, it
} from 'vitest';
import {
  render, within
} from '@testing-library/react';
import type { BrandKpis } from '../../../types/domain/groupKpiHistory';
import {
  KPI_DEFINITIONS, KPI_SPECS
} from '../../../constants/kpiDefinitions';
import {
  buildKpis, GROUP_DELTAS, GROUP_TRENDS
} from '../BrandVisibilityReport/groupKpiHistory-fixtures';
import {
  KpiHeadline, type KpiComparison
} from './KpiHeadline';
import { ReportSection } from './ReportSection';
import {
  kpiRowTooltips, sectionTable, statCard, statFigure, statFootnote
} from './reportQueries-fixtures';

/**
 * Each headline card of `buildKpis()` compared through `GROUP_DELTAS` and
 * `GROUP_TRENDS`: its KPI, caption, figure, change and the colour of its trend.
 */
const HEADLINE_CARDS = [
  ['mention_rate', 'Mention rate', '60.0%', '-10.0 pts', 'text-red-700'],
  ['share_of_voice', 'Share of voice', '25.0%', '+5.0 pts', 'text-emerald-700'],
  ['visibility_score', 'Visibility score', '52.4', '-8.2 pts', 'text-red-700'],
  ['citation_rate', 'Citation rate', '30.0%', '+1.2 pts', 'text-gray-900'],
] as const;

/** The caption of every headline card, left to right. */
export const HEADLINE_LABELS = HEADLINE_CARDS.map(([, label]) => label);

/** Every row of the KPI table of `buildKpis()` compared through `GROUP_DELTAS` and `GROUP_TRENDS`: KPI, value, change, trend. */
const KPI_TABLE_ROWS = [
  ['Answers', '20', '0', '—'],
  ['Mentions', '12', '-2', '—'],
  ['Mention rate', '60.0%', '-10.0 pts', 'Declining'],
  ['Share of voice', '25.0%', '+5.0 pts', 'Improving'],
  ['Average position', '1.80', '+0.50', 'Declining'],
  ['Top-1 share', '40.0%', '+3.0 pts', 'Improving'],
  ['Top-3 share', '55.0%', '+1.5 pts', 'Stable'],
  ['Visibility score', '52.4', '-8.2 pts', 'Declining'],
  ['Citations', '6', '+1', '—'],
  ['Citation rate', '30.0%', '+1.2 pts', 'Stable'],
  ['Citation share', '12.5%', '-2.5 pts', 'Declining'],
  ['Net sentiment', '+15.0', '+10.0 pts', 'Improving'],
  ['Engine coverage', '75.0%', '+0.8 pts', 'Stable'],
  ['Keyword coverage', '80.0%', '-20.0 pts', 'Declining'],
];

export const COMPARISON_LABEL = 'vs previous day (3 keywords)';

/** A card footnote of `renderKpiHeadline()`: the change, then what it compares with. */
export function dayFootnote(change: string): string {
  return `${change} ${COMPARISON_LABEL}`;
}

/** `GROUP_DELTAS` and `GROUP_TRENDS`, labelled as a day-over-day change. */
const DAY_COMPARISON: KpiComparison = {
  deltas: GROUP_DELTAS,
  trends: GROUP_TRENDS,
  label: COMPARISON_LABEL,
};

export const NO_COMPARISON_NOTE = 'Nothing to compare with';

interface Options {
  readonly kpis?: BrandKpis;
  readonly comparison?: KpiComparison | null;
  readonly citationsConfigured?: boolean;
}

/** Mount `KpiHeadline` in a "Headline" section: `buildKpis()` compared day over day, owned domains set, unless told otherwise. */
export function renderKpiHeadline({
  kpis = buildKpis(), comparison = DAY_COMPARISON, citationsConfigured = true
}: Options = {}): void {
  render(
    <ReportSection title="Headline">
      <KpiHeadline
        kpis={kpis}
        comparison={comparison}
        noComparisonNote={NO_COMPARISON_NOTE}
        citationsConfigured={citationsConfigured}
      />
    </ReportSection>,
  );
}

/**
 * Mounts a "Headline" section showing `KpiHeadline` over `buildKpis()`: the
 * headline itself, or a report that renders it (after picking a run, say).
 */
type MountHeadline = () => unknown;

/**
 * The cards of a headline compared through `GROUP_DELTAS` and `GROUP_TRENDS`,
 * shared by `KpiHeadline` and every report that mounts it with those KPIs.
 * `footnote` writes a change followed by what the headline compares with.
 */
export function itShowsHeadlineCards(mount: MountHeadline, footnote: (change: string) => string): void {
  it.each(HEADLINE_CARDS)('shows the %s value as %s', async (_id, label, value) => {
    await mount();

    expect(statFigure(label).textContent).toBe(value);
  });

  it.each(HEADLINE_CARDS)('writes the %s change followed by what it compares with', async (_id, label, _value, change) => {
    await mount();

    expect(statFootnote(label)).toBe(footnote(change));
  });

  it.each(HEADLINE_CARDS)('colours the %s figure by its trend', async (_id, label, _value, _change, colour) => {
    await mount();

    expect(statFigure(label)).toHaveClass(colour);
  });

  it.each(HEADLINE_CARDS)('explains in the card tooltip how %s is measured', async (id, label) => {
    await mount();

    expect(within(statCard(label)).getByRole('button')).toHaveAccessibleDescription(KPI_DEFINITIONS[id].definition);
  });
}

/** The KPI table under the cards of a headline compared through `GROUP_DELTAS` and `GROUP_TRENDS`. */
export function itShowsKpiTable(mount: MountHeadline): void {
  it('heads the KPI table with the KPI, its value, change and trend', async () => {
    await mount();

    expect(sectionTable('Headline')[0]).toStrictEqual(['KPI', 'Value', 'Change', 'Trend']);
  });

  it('lists every KPI in report order with its value, change and trend', async () => {
    await mount();

    expect(sectionTable('Headline').slice(1)).toStrictEqual(KPI_TABLE_ROWS);
  });

  it('explains every KPI row of the table in a tooltip holding its definition', async () => {
    await mount();

    expect(kpiRowTooltips()).toStrictEqual(KPI_SPECS.map((spec) => [`About ${spec.label}`, spec.definition]));
  });
}

/** A headline with nothing to compare with; `note` is what every card says instead of a change. */
export function itShowsNoComparison(mount: MountHeadline, note: string): void {
  it('writes the no-comparison note under every card', async () => {
    await mount();

    expect(HEADLINE_LABELS.map(statFootnote)).toStrictEqual(HEADLINE_LABELS.map(() => note));
  });

  it('colours every card neutral', async () => {
    await mount();

    expect(HEADLINE_LABELS.map((label) => statFigure(label).classList.contains('text-gray-900'))).toStrictEqual([true, true, true, true]);
  });

  it('shows no change and no trend for any KPI of the table', async () => {
    await mount();

    expect(sectionTable('Headline').slice(1).map((row) => row.slice(2))).toStrictEqual(KPI_SPECS.map(() => ['—', '—']));
  });
}

/** A headline before owned domains are set; `footnote` as for `itShowsHeadlineCards`. */
export function itAsksForOwnedDomains(mount: MountHeadline, footnote: (change: string) => string): void {
  it('asks for owned domains under the citation rate instead of its change', async () => {
    await mount();

    expect(statFootnote('Citation rate')).toBe('Set owned domains in Settings › Brand Tracking to measure citations');
  });

  it('keeps the change under the other cards', async () => {
    await mount();

    expect(statFootnote('Mention rate')).toBe(footnote('-10.0 pts'));
  });
}
