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
import {
  definitionTerms, sectionTitles, statFigure, statFootnote
} from '../layout/reportQueries-fixtures';
import { VISIBILITY_DEFINITIONS } from '../../../constants/kpiDefinitions';


vi.mock('./useKeywordDeepDive', () => ({useKeywordDeepDive: vi.fn(),}));
vi.mock('../../../hooks/usePrintMode', () => ({usePrintMode: vi.fn(() => ({ isPrintMode: false })),}));

import { useKeywordDeepDive } from './useKeywordDeepDive';

const mockUseKeywordDeepDive = useKeywordDeepDive as ReturnType<typeof vi.fn>;

const KEYWORDS = [
  { keyword: 'best running shoes' },
  { keyword: 'best hiking boots' },
];

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/reports/keyword/:keyword"
          element={
            <KeywordDeepDiveReport keywords={KEYWORDS as never} />
          }
        />
        <Route
          path="/reports/keyword"
          element={
            <KeywordDeepDiveReport keywords={KEYWORDS as never} />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('KeywordDeepDiveReport', () => {
  beforeEach(() => {
    mockUseKeywordDeepDive.mockReturnValue(settledData());
  });

  it('renders the H1 with the keyword from the URL params', () => {
    renderAt('/reports/keyword/best%20running%20shoes');
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /Keyword Deep Dive: best running shoes/,
      }),
    ).toBeInTheDocument();
  });

  it('shows the keyword KPIs of the visibility answer in the headline', () => {
    renderAt('/reports/keyword/best%20running%20shoes');

    expect(statFigure('Visibility score').textContent).toBe('52.4');
  });

  it('writes the headline change against the previous run', () => {
    renderAt('/reports/keyword/best%20running%20shoes');

    expect(statFootnote('Share of voice')).toBe('+5.0 pts vs previous run (3 keywords)');
  });

  it('shows the KPI history after the headline and ends with the definitions', () => {
    renderAt('/reports/keyword/best%20running%20shoes');

    const titles = sectionTitles();
    expect([...titles.slice(0, 2), ...titles.slice(-1)]).toStrictEqual(['Headline', 'KPI history', 'How these KPIs are measured']);
  });

  it('defines every KPI and the trend rule in the definitions block', () => {
    renderAt('/reports/keyword/best%20running%20shoes');

    expect(definitionTerms()).toStrictEqual(VISIBILITY_DEFINITIONS.map((entry) => entry.label));
  });

  it('renders the keyword selector populated with every configured keyword', () => {
    renderAt('/reports/keyword/best%20running%20shoes');
    const select = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toContain('best running shoes');
    expect(optionValues).toContain('best hiking boots');
  });

  it('navigates to a new keyword when the selector changes', async () => {
    const user = userEvent.setup();
    renderAt('/reports/keyword/best%20running%20shoes');
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
