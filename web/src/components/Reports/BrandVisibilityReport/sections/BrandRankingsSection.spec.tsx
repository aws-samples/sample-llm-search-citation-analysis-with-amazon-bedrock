import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import type { BrandLeaderboardRow } from '../../../../types';
import { expectRendersNothing } from '../../../../test/renderNothing';
import {
  BEST_POSITION_INFO, BrandRankingsSection, MAX_BRANDS
} from './BrandRankingsSection';
import {
  buildBrandRow, buildBrandTrends, buildVisibility
} from '../../layout/reportPayload-fixtures';
import {
  headerTooltips, sectionTable, sectionTitled, tableRow
} from '../../layout/reportQueries-fixtures';
import {
  BRAND_TRENDS_SOV_CAPTION, VISIBILITY_BRANDS_SOV_CAPTION, chartCaption, hasChartPanel
} from './reportChartPanels-fixtures';
import { rankingsShareOfVoiceCaption } from './brandRankings-fixtures';
import { SHARE_OF_VOICE_TREND_TITLE } from './ReportChartPanels';
import { KPI_DEFINITIONS } from '../../../../constants/kpiDefinitions';

vi.mock('chart.js', () => import('../../../Dashboard/chartJs-fixtures'));

const TITLE = 'Brand rankings';

function renderRankings(brands: readonly BrandLeaderboardRow[] = buildVisibility().brands): void {
  render(<BrandRankingsSection brands={brands} loading={false} error={null} />);
}

describe('BrandRankingsSection columns', () => {
  it('heads the leaderboard with the brand, its KPIs, best position, engines, keywords and type', () => {
    renderRankings();

    expect(sectionTable(TITLE)[0]).toStrictEqual([
      'Brand', 'Visibility score', 'Mention rate', 'Share of voice', 'Average position', 'Best position', 'Engines', 'Keywords', 'Type',
    ]);
  });

  it('writes each brand with its KPIs formatted by unit, in the API order', () => {
    renderRankings();

    expect(sectionTable(TITLE).slice(1)).toStrictEqual([
      ['Nike', '52.4', '60.0%', '25.0%', '1.80', '1', 'gemini, openai', '1', 'first-party'],
      ['Adidas', '30.0', '60.0%', '25.0%', '1.80', '1', 'gemini, openai', '1', 'competitor'],
    ]);
  });

  it('shows the unknown KPIs of a brand without a placed mention as dashes', () => {
    renderRankings([buildBrandRow('Unplaced', {
      average_position: null,
      best_position: null,
      mention_rate: null,
      share_of_voice: null,
    })]);

    expect(sectionTable(TITLE)[1].slice(2, 6)).toStrictEqual(['—', '—', '—', '—']);
  });

  it('explains each KPI column with its definition', () => {
    renderRankings();

    expect(headerTooltips(TITLE).slice(0, 4)).toStrictEqual(
      (['visibility_score', 'mention_rate', 'share_of_voice', 'average_position'] as const)
        .map((id) => [KPI_DEFINITIONS[id].label, KPI_DEFINITIONS[id].definition]),
    );
  });

  it('explains the best position in its own words', () => {
    renderRankings();

    expect(headerTooltips(TITLE)[4]).toStrictEqual(['Best position', BEST_POSITION_INFO]);
  });
});

describe('BrandRankingsSection rows', () => {
  it.each([
    ['tints', 'Nike', true],
    ['does not tint', 'Adidas', false],
  ])('%s the row of %s by whether it is first-party', (_label, brand, tinted) => {
    renderRankings();

    expect(tableRow(TITLE, brand).classList.contains('bg-emerald-50')).toBe(tinted);
  });

  it('labels an other brand as other', () => {
    renderRankings([buildBrandRow('Blog', { classification: 'other' })]);

    expect(sectionTable(TITLE)[1][8]).toBe('other');
  });

  it('lists at most the printable number of brands', () => {
    renderRankings(Array.from({ length: MAX_BRANDS + 3 }, (_, index) => buildBrandRow(`Brand ${index}`)));

    expect(sectionTable(TITLE)).toHaveLength(MAX_BRANDS + 1);
  });
});

describe('BrandRankingsSection charts', () => {
  it('charts the share of voice of every brand above the leaderboard', () => {
    renderRankings();

    expect(rankingsShareOfVoiceCaption()).toBe(VISIBILITY_BRANDS_SOV_CAPTION);
  });

  it('charts the share of voice per brand over time when given the brand trends', () => {
    render(<BrandRankingsSection brands={buildVisibility().brands} brandTrends={buildBrandTrends()} loading={false} error={null} />);

    expect(chartCaption(SHARE_OF_VOICE_TREND_TITLE, sectionTitled(TITLE))).toBe(BRAND_TRENDS_SOV_CAPTION);
  });

  it('charts no share of voice over time without brand trends', () => {
    renderRankings();

    expect(hasChartPanel(SHARE_OF_VOICE_TREND_TITLE)).toBe(false);
  });
});

describe('BrandRankingsSection states', () => {
  it('says when no brand was named for the keyword', () => {
    renderRankings([]);

    expect(screen.getByText('No brand mentions extracted for this keyword.')).toBeInTheDocument();
  });

  it('says the empty message it is given when no brand was named', () => {
    render(<BrandRankingsSection brands={[]} loading={false} error={null} emptyMessage="No brand in the latest periods." />);

    expect(screen.getByText('No brand in the latest periods.')).toBeInTheDocument();
  });

  it('describes the leaderboard with the subtitle it is given', () => {
    render(<BrandRankingsSection brands={buildVisibility().brands} loading={false} error={null} subtitle="Every brand of every keyword." />);

    expect(screen.getByText('Every brand of every keyword.')).toBeInTheDocument();
  });

  it('shows the loading state', () => {
    render(<BrandRankingsSection brands={null} loading error={null} />);

    expect(screen.getByText('Loading brand rankings…')).toBeInTheDocument();
  });

  it('shows the error', () => {
    render(<BrandRankingsSection brands={null} loading={false} error="Network down" />);

    expect(screen.getByText('Network down')).toBeInTheDocument();
  });

  it('drops out of the report without a leaderboard', () => {
    expectRendersNothing(<BrandRankingsSection brands={null} loading={false} error={null} />);
  });
});
