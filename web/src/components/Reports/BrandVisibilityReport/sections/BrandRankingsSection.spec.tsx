import {
  describe, expect, it
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import type { VisibilityResponse } from '../../../../types';
import { expectRendersNothing } from '../../../../test/renderNothing';
import {
  BEST_POSITION_INFO, BrandRankingsSection, MAX_BRANDS
} from './BrandRankingsSection';
import {
  buildBrandRow, buildVisibility
} from '../../layout/reportPayload-fixtures';
import {
  headerTooltips, sectionTable, tableRow
} from '../../layout/reportQueries-fixtures';
import { KPI_DEFINITIONS } from '../../../../constants/kpiDefinitions';

const TITLE = 'Brand rankings';

function renderRankings(visibility: VisibilityResponse = buildVisibility()): void {
  render(<BrandRankingsSection visibility={visibility} loading={false} error={null} />);
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
    renderRankings(buildVisibility({
      brands: [buildBrandRow('Unplaced', {
        average_position: null,
        best_position: null,
        mention_rate: null,
        share_of_voice: null,
      })],
    }));

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
    renderRankings(buildVisibility({ brands: [buildBrandRow('Blog', { classification: 'other' })] }));

    expect(sectionTable(TITLE)[1][8]).toBe('other');
  });

  it('lists at most the printable number of brands', () => {
    renderRankings(buildVisibility({ brands: Array.from({ length: MAX_BRANDS + 3 }, (_, index) => buildBrandRow(`Brand ${index}`)) }));

    expect(sectionTable(TITLE)).toHaveLength(MAX_BRANDS + 1);
  });
});

describe('BrandRankingsSection states', () => {
  it('says when no brand was named for the keyword', () => {
    renderRankings(buildVisibility({ brands: [] }));

    expect(screen.getByText('No brand mentions extracted for this keyword.')).toBeInTheDocument();
  });

  it('shows the loading state', () => {
    render(<BrandRankingsSection visibility={null} loading error={null} />);

    expect(screen.getByText('Loading brand rankings…')).toBeInTheDocument();
  });

  it('shows the error', () => {
    render(<BrandRankingsSection visibility={null} loading={false} error="Network down" />);

    expect(screen.getByText('Network down')).toBeInTheDocument();
  });

  it('drops out of the report without a visibility answer', () => {
    expectRendersNothing(<BrandRankingsSection visibility={null} loading={false} error={null} />);
  });
});
