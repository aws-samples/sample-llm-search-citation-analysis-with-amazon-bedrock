import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MemoryRouter, Routes, Route
} from 'react-router-dom';
import { KeywordDeepDiveReport } from './KeywordDeepDiveReport';
import { settledData } from './KeywordDeepDiveReport-fixtures';
import { expectRunAnalysisLink } from '../../ui/NoDataYet-fixtures';
import { buildVisibility } from '../layout/reportPayload-fixtures';
import { CurrentLocation } from '../scopeReport/scopeReport-fixtures';
import {
  definitionTerms, VISIBILITY_DEFINITION_TERMS, sectionTable, sectionTitles, statFigure, statFootnote
} from '../layout/reportQueries-fixtures';
import type { Keyword } from '../../../types';
import { VISIBILITY_BRANDS_SOV_CAPTION } from '../BrandVisibilityReport/sections/reportChartPanels-fixtures';
import {
  rankedBrandNames, rankingsShareOfVoiceCaption
} from '../BrandVisibilityReport/sections/brandRankings-fixtures';


vi.mock('./useKeywordDeepDive', () => ({useKeywordDeepDive: vi.fn(),}));
vi.mock('../../../hooks/usePrintMode', () => ({usePrintMode: vi.fn(() => ({ isPrintMode: false })),}));
vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));

import { useKeywordDeepDive } from './useKeywordDeepDive';

const mockUseKeywordDeepDive = vi.mocked(useKeywordDeepDive);

const KEYWORDS: Keyword[] = ['best running shoes', 'best hiking boots'].map((keyword, index) => ({
  id: String(index + 1),
  keyword,
  created_at: '2026-01-01T00:00:00Z',
}));

const REPORT = (
  <>
    <KeywordDeepDiveReport keywords={KEYWORDS} />
    <CurrentLocation />
  </>
);

/** The report opened at `path`, the "best running shoes" deep dive unless given. */
function renderDeepDive(path = '/reports/keyword/best%20running%20shoes') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reports/keyword/:keyword" element={REPORT} />
        <Route path="/reports/keyword" element={REPORT} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The deep dive of a keyword no engine answered yet. */
function renderUnansweredDeepDive() {
  mockUseKeywordDeepDive.mockReturnValue({
    ...settledData(),
    visibility: buildVisibility({ keywords_with_data: 0 }),
  });
  return renderDeepDive();
}

describe('KeywordDeepDiveReport', () => {
  beforeEach(() => {
    mockUseKeywordDeepDive.mockReturnValue(settledData());
  });

  it('renders the H1 with the keyword from the URL params', () => {
    renderDeepDive();
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /Keyword Deep Dive: best running shoes/,
      }),
    ).toBeInTheDocument();
  });

  it('shows the keyword KPIs of the visibility answer in the headline', () => {
    renderDeepDive();

    expect(statFigure('Visibility score').textContent).toBe('52.4');
  });

  it('writes the headline change against the previous run', () => {
    renderDeepDive();

    expect(statFootnote('Share of voice')).toBe('+5.0 pts vs previous run (3 keywords)');
  });

  it('shows the KPI history after the headline and ends with the definitions', () => {
    renderDeepDive();

    const titles = sectionTitles();
    expect([...titles.slice(0, 2), ...titles.slice(-1)]).toStrictEqual(['Headline', 'KPI history', 'How these KPIs are measured']);
  });

  it('ranks the brands of the keyword after its KPI history, then compares the AI engines', () => {
    renderDeepDive();

    expect(sectionTitles().slice(1, 4)).toStrictEqual(['KPI history', 'Brand rankings', 'KPIs per AI engine']);
  });

  it('lists the brands of the visibility answer in the brand rankings', () => {
    renderDeepDive();

    expect(rankedBrandNames()).toStrictEqual(['Nike', 'Adidas']);
  });

  it('charts the share of voice of the visibility answer in the brand rankings', () => {
    renderDeepDive();

    expect(rankingsShareOfVoiceCaption()).toBe(VISIBILITY_BRANDS_SOV_CAPTION);
  });

  it('shows the brand rankings loading while the visibility answer is in flight', () => {
    mockUseKeywordDeepDive.mockReturnValue({
      ...settledData(),
      visibility: null,
      visibilityLoading: true,
    });
    renderDeepDive();

    expect(screen.getByText('Loading brand rankings…')).toBeInTheDocument();
  });

  it('lists every AI engine of the visibility answer in the engine table', () => {
    renderDeepDive();

    expect(sectionTable('KPIs per AI engine').slice(1).map(([engine]) => engine)).toStrictEqual(['Google Gemini', 'OpenAI']);
  });

  it('defines every KPI and the trend rule in the definitions block', () => {
    renderDeepDive();

    expect(definitionTerms()).toStrictEqual(VISIBILITY_DEFINITION_TERMS);
  });

  it('renders the keyword selector populated with every configured keyword', () => {
    renderDeepDive();
    const select = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toContain('best running shoes');
    expect(optionValues).toContain('best hiking boots');
  });

  it('opens the first keyword with the page query kept, so a print link still prints', () => {
    renderDeepDive('/reports/keyword?print=1');

    expect(screen.getByLabelText('Current location').textContent).toBe('/reports/keyword/best%20running%20shoes?print=1');
  });

  it('shows one notice instead of the sections for a keyword no engine answered', () => {
    renderUnansweredDeepDive();

    expect(sectionTitles()).toStrictEqual(['No AI answers yet', 'How these KPIs are measured']);
  });

  it('shows the notice when brand mentions report no run for the keyword', () => {
    mockUseKeywordDeepDive.mockReturnValue({
      ...settledData(),
      mentionsNoData: true,
    });
    renderDeepDive();

    expect(sectionTitles()).toStrictEqual(['No AI answers yet', 'How these KPIs are measured']);
  });

  it('links the no-answers notice to Run Analysis', () => {
    renderUnansweredDeepDive();

    expectRunAnalysisLink();
  });

  it('lists the keywords in the selector alphabetically', () => {
    renderDeepDive();

    const select = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toStrictEqual(['best hiking boots', 'best running shoes']);
  });

  it('navigates to a new keyword when the selector changes', async () => {
    const user = userEvent.setup();
    renderDeepDive();
    const select = screen.getAllByRole('combobox')[0];
    await user.selectOptions(select, 'best hiking boots');
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /Keyword Deep Dive: best hiking boots/,
      }),
    ).toBeInTheDocument();
  });
});
