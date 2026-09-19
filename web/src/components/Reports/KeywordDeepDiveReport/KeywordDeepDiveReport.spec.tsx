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

  it('renders the headline visibility score from the visibility data', () => {
    renderAt('/reports/keyword/best%20running%20shoes');
    expect(screen.getByText('42.0')).toBeInTheDocument();
  });

  it('renders the headline first-party share-of-voice from the visibility data', () => {
    renderAt('/reports/keyword/best%20running%20shoes');
    // first_party_total_sov = 12 in fixture -> rendered as "12.0%".
    expect(screen.getByText('12.0%')).toBeInTheDocument();
  });

  it('renders the competitor average score in the headline footnote', () => {
    renderAt('/reports/keyword/best%20running%20shoes');
    // competitor_avg_score = 38 in fixture -> footnote "Competitor avg: 38.0".
    expect(screen.getByText(/Competitor avg: 38\.0/)).toBeInTheDocument();
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
