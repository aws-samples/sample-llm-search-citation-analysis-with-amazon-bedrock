import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  fireEvent, render, screen, waitFor, within
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expectRunAnalysisLink } from '../ui/NoDataYet-fixtures';
import { renderedScopeOptionLabels } from '../ui/KeywordScopeSelector-fixtures';
import {
  installIntersectionObserverMock, scrollSentinelIntoView
} from '../../test/intersectionObserverMock';
import { TestError } from '../../test/testError';
import {
  brandKeywordsFixture,
  brandMentionsExportResponse,
  firstOfManyBrandsResponse,
  GROUP_REPORT_SCOPE,
  GROUP_SCOPE_VALUE,
  HISTORICAL_BRAND_RUN,
  KEYWORD_REPORT_SCOPE,
  LATEST_BRAND_RUN,
  secondPageBrand,
  selectBrandRun,
  selectBrandScope,
} from './brandMentionsExport-fixtures';

const mocks = vi.hoisted(() => ({
  useBrandMentions: vi.fn(),
  exportBrandMentionsFor: vi.fn(),
  fetchBrandSummaryPage: vi.fn(),
}));

vi.mock('../../hooks/useBrandMentions', () => ({useBrandMentions: mocks.useBrandMentions,}));

vi.mock('./brandMentionsExport', () => ({exportBrandMentionsFor: mocks.exportBrandMentionsFor,}));

vi.mock('../../api/brandMentions', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../api/brandMentions')>(),
  fetchBrandSummaryPage: mocks.fetchBrandSummaryPage,
}));

vi.mock('../../hooks/useBrandConfig', () => ({ useBrandConfig: vi.fn() }));

// A bare mock, configured below: the fixtures module renders the real hook in
// its own helpers, so importing it inside this factory would wait on the very
// module being mocked.
vi.mock('../../hooks/useKeywordGroups', () => ({ useKeywordGroups: vi.fn() }));

import { BrandsView } from './BrandsView';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';
import { useBrandConfig } from '../../hooks/useBrandConfig';
import { buildBrandConfigHookResult } from '../../test/brandConfigHookMock';
import { buildKeywordGroupsHookResult } from '../../hooks/useKeywordGroups-fixtures';
import { labelledFieldIdentity } from '../../test/fieldIdentity';

vi.mock('../Personas/PersonaSelector', () => ({
  PersonaSelector: ({
    id, name, selectedPersonaId, onPersonaChange
  }: {
    id: string;
    name: string;
    selectedPersonaId: string | null;
    onPersonaChange: (personaId: string | null) => void;
  }) => (
    <button
      type="button"
      aria-label="Choose reporting persona"
      data-field-id={id}
      data-field-name={name}
      onClick={() => onPersonaChange('persona-a')}
    >
      {selectedPersonaId ?? 'All Personas'}
    </button>
  ),
}));

/** Renders the view over the fixture keywords and picks `scope` (the keyword by default). */
function renderWithBrandScope(scope?: string): void {
  render(<BrandsView keywords={brandKeywordsFixture} />);
  selectBrandScope(scope);
}

/** Renders the view with a scope picked and the historical analysis run selected. */
function renderWithHistoricalRun(scope?: string): void {
  renderWithBrandScope(scope);
  selectBrandRun();
}

/** Renders the keyword scope and presses the export button. */
function renderAndPressExport(): void {
  renderWithBrandScope();
  fireEvent.click(screen.getByRole('button', { name: 'Export to Excel' }));
}

describe('BrandsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useKeywordGroups).mockReturnValue(buildKeywordGroupsHookResult());
    vi.mocked(useBrandConfig).mockReturnValue(buildBrandConfigHookResult());
    mocks.useBrandMentions.mockReturnValue({
      data: brandMentionsExportResponse,
      loading: false,
      error: null,
    });
    mocks.exportBrandMentionsFor.mockResolvedValue(undefined);
  });

  it('shows a neutral "no AI answers yet" state with a Run Analysis link, not an error, for a keyword with no run', () => {
    mocks.useBrandMentions.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      noData: true,
    });

    render(<MemoryRouter><BrandsView keywords={brandKeywordsFixture} /></MemoryRouter>);

    expect(screen.getByText(/No AI engine has answered for .* yet/)).toBeInTheDocument();
    expectRunAnalysisLink();
    expect(screen.queryByText(/No brand data found/)).not.toBeInTheDocument();
  });

  it('renders the Brand Mentions heading when there are no keywords', () => {
    render(<BrandsView keywords={[]} />);

    expect(screen.getByRole('heading', { name: 'Brand Mentions' })).toBeInTheDocument();
  });

  it('shows the scope panel title when keywords are available', () => {
    render(<BrandsView keywords={brandKeywordsFixture} />);

    expect(screen.getByText('What to look at')).toBeInTheDocument();
  });

  it('offers the keyword its group and all keywords as scopes', () => {
    render(<BrandsView keywords={brandKeywordsFixture} />);

    expect(renderedScopeOptionLabels()).toStrictEqual(['All keywords', 'Hotel Coruña (1)', 'hotels']);
  });

  it('loads all keywords on arrival, matching the scope the selector shows', () => {
    render(<BrandsView keywords={brandKeywordsFixture} />);

    expect({
      selected: screen.getByLabelText('Scope'),
      lastCall: mocks.useBrandMentions.mock.lastCall,
    }).toStrictEqual({
      selected: expect.objectContaining({ value: 'all' }),
      lastCall: [{ kind: 'all' }, null, null, null],
    });
  });

  it('asks for nothing and says what to do when no keywords are available', () => {
    render(<BrandsView keywords={[]} />);

    expect({
      message: screen.getByText(/^No keywords available\./).textContent,
      lastScope: mocks.useBrandMentions.mock.lastCall?.[0],
    }).toStrictEqual({
      message: 'No keywords available. Add keywords in Settings › Keywords, then run an analysis.',
      lastScope: null,
    });
  });

  it('supplies a brands-specific identity to the persona selector', () => {
    render(<BrandsView keywords={brandKeywordsFixture} />);

    const personaSelector = screen.getByRole('button', { name: 'Choose reporting persona' });

    expect({
      id: personaSelector.getAttribute('data-field-id'),
      name: personaSelector.getAttribute('data-field-name'),
    }).toStrictEqual({
      id: 'brands-persona-filter',
      name: 'brands-persona-filter',
    });
  });

  it('shows the brand mentions skeleton while the first answer for a scope loads', () => {
    mocks.useBrandMentions.mockReturnValue({
      data: null,
      loading: true,
      error: null,
    });
    renderWithBrandScope();

    expect(screen.getByText('Loading brand mentions')).toBeInTheDocument();
  });

  it('keeps the previous results on screen, marked busy, while a refetch loads', () => {
    mocks.useBrandMentions.mockReturnValue({
      data: brandMentionsExportResponse,
      loading: true,
      error: null,
    });
    renderWithBrandScope();
    const exportButton = screen.getByRole('button', { name: 'Export to Excel' });

    expect(exportButton.closest('[aria-busy="true"]')).not.toBeNull();
  });

  it('offers Latest and exact run values when a scope is selected', () => {
    renderWithBrandScope();

    const runSelector = screen.getByLabelText('Analysis run');
    const options = within(runSelector).getAllByRole('option').map((option) => ({
      label: option.textContent,
      value: option.getAttribute('value'),
    }));

    expect(options).toStrictEqual([
      {
        label: 'Latest',
        value: ''
      },
      {
        label: LATEST_BRAND_RUN,
        value: LATEST_BRAND_RUN
      },
      {
        label: HISTORICAL_BRAND_RUN,
        value: HISTORICAL_BRAND_RUN
      },
    ]);
    expect(runSelector).toHaveValue('');
  });

  it('associates the analysis-run label with a brands-specific identity', () => {
    renderWithBrandScope();

    expect(labelledFieldIdentity('Analysis run')).toStrictEqual({
      id: 'brands-analysis-run',
      labelFor: 'brands-analysis-run',
      name: 'brands-analysis-run',
    });
  });

  it('passes the historical timestamp to the data hook when a run is selected', () => {
    renderWithHistoricalRun();

    expect(mocks.useBrandMentions).toHaveBeenLastCalledWith(
      KEYWORD_REPORT_SCOPE,
      null,
      null,
      HISTORICAL_BRAND_RUN
    );
  });

  it.each([
    ['report scope', () => selectBrandScope(GROUP_SCOPE_VALUE), GROUP_REPORT_SCOPE, null],
    [
      'persona',
      () => fireEvent.click(screen.getByRole('button', { name: 'Choose reporting persona' })),
      KEYWORD_REPORT_SCOPE,
      'persona-a',
    ],
  ])('resets the historical run when the %s changes', (_changed, change, scope, personaId) => {
    renderWithHistoricalRun();
    change();

    expect(screen.getByLabelText('Analysis run')).toHaveValue('');
    expect(mocks.useBrandMentions).toHaveBeenLastCalledWith(scope, null, personaId, null);
  });

  it('labels the selected aggregate analysis run with keyword coverage', () => {
    renderWithHistoricalRun(GROUP_SCOPE_VALUE);

    expect(screen.getByText(
      `Analysis run ${HISTORICAL_BRAND_RUN} includes data for 1 of 2 keywords in Hotel Coruña.`
    )).toBeInTheDocument();
  });

  it('exports every appearance of the selected scope and filters when the button is pressed', async () => {
    renderAndPressExport();

    await waitFor(() => {
      expect(mocks.exportBrandMentionsFor).toHaveBeenCalledWith({
        scope: KEYWORD_REPORT_SCOPE,
        marketId: null,
        filters: {
          classification: null,
          query_prompt_id: null,
          timestamp: null,
        },
      }, 'hotels');
    });
  });

  describe('with more brands than one page', () => {
    beforeEach(() => {
      installIntersectionObserverMock();
      vi.spyOn(console, 'error').mockImplementation(vi.fn());
      mocks.useBrandMentions.mockReturnValue({
        data: firstOfManyBrandsResponse,
        loading: false,
        error: null,
      });
    });

    it('says how many of the matching brands are loaded', () => {
      renderWithBrandScope();

      expect(screen.getByText(/Showing 2 of 140 brands · more load as you scroll/)).toBeInTheDocument();
    });

    it('loads the next brands for the same query as the reader scrolls to the end', async () => {
      mocks.fetchBrandSummaryPage.mockResolvedValue({
        items: [secondPageBrand],
        nextToken: null,
      });
      renderWithBrandScope();

      scrollSentinelIntoView();

      expect(await screen.findByText('Parador Lejano')).toBeInTheDocument();
      expect(mocks.fetchBrandSummaryPage).toHaveBeenCalledWith(expect.objectContaining({ scope: KEYWORD_REPORT_SCOPE }), 'brands-2', expect.any(AbortSignal));
    });

    it('says the list stops at the first page when the API hands out no token', () => {
      mocks.useBrandMentions.mockReturnValue({
        data: {
          ...firstOfManyBrandsResponse,
          aggregated: {
            ...firstOfManyBrandsResponse.aggregated,
            next_token: undefined,
          },
        },
        loading: false,
        error: null,
      });
      renderWithBrandScope();

      expect(screen.getByText('Showing the top 2 of 140 brands; the Excel export has every mention.')).toBeInTheDocument();
    });

    it('offers Try again when a page fails', async () => {
      mocks.fetchBrandSummaryPage.mockRejectedValue(new TestError('HTTP 500'));
      renderWithBrandScope();

      scrollSentinelIntoView();

      expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });
  });

  it('shows the export loading state while the workbook is being generated', () => {
    mocks.exportBrandMentionsFor.mockImplementation(() => new Promise(vi.fn()));
    renderAndPressExport();

    expect(screen.getByRole('button', { name: 'Exporting…' })).toBeDisabled();
  });
});
