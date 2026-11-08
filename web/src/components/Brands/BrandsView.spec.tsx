import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  fireEvent, render, screen, within
} from '@testing-library/react';
import { renderedScopeOptionLabels } from '../ui/KeywordScopeSelector-fixtures';
import {
  computingLabel, COMPUTING_JOB
} from '../../test/scopedTestKit';
import {
  brandKeywordsFixture,
  brandMentionsExportResponse,
  GROUP_REPORT_SCOPE,
  GROUP_SCOPE_VALUE,
  HISTORICAL_BRAND_RUN,
  KEYWORD_REPORT_SCOPE,
  LATEST_BRAND_RUN,
  selectBrandRun,
  selectBrandScope,
} from './brandMentionsExport-fixtures';

const mocks = vi.hoisted(() => ({useBrandMentions: vi.fn(),}));

vi.mock('../../hooks/useBrandMentions', () => ({useBrandMentions: mocks.useBrandMentions,}));

vi.mock('../../api/exports', () => import('../../test/exportsApiMock'));

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
import {
  chooseExportFormat, mockStartExport
} from '../../test/exportsApiMock';

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

describe('BrandsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useKeywordGroups).mockReturnValue(buildKeywordGroupsHookResult());
    vi.mocked(useBrandConfig).mockReturnValue(buildBrandConfigHookResult());
    mocks.useBrandMentions.mockReturnValue({
      computing: null,
      data: brandMentionsExportResponse,
      loading: false,
      error: null,
    });
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

  it('asks for a scope when no scope has been selected', () => {
    render(<BrandsView keywords={brandKeywordsFixture} />);

    expect(screen.getByText('Pick a scope above to view brand mentions')).toBeInTheDocument();
  });

  it('shows the empty-keyword message when no keywords are available', () => {
    render(<BrandsView keywords={[]} />);

    expect(screen.getByText('No keywords available.')).toBeInTheDocument();
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
      computing: null,
      data: null,
      loading: true,
      error: null,
    });
    renderWithBrandScope();

    expect(screen.getByText('Loading brand mentions')).toBeInTheDocument();
  });

  it('says the brand mentions are being computed while a view job runs for an older run', () => {
    mocks.useBrandMentions.mockReturnValue({
      computing: COMPUTING_JOB,
      data: brandMentionsExportResponse,
      loading: true,
      error: null,
    });
    renderWithBrandScope();

    expect(computingLabel('brand mentions')).toBeInTheDocument();
  });

  it('keeps the previous results on screen, marked busy, while a refetch loads', () => {
    mocks.useBrandMentions.mockReturnValue({
      computing: null,
      data: brandMentionsExportResponse,
      loading: true,
      error: null,
    });
    renderWithBrandScope();
    const exportButton = screen.getByRole('button', { name: 'Export all' });

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

    const runSelector = screen.getByLabelText<HTMLSelectElement>('Analysis run');

    expect({
      id: runSelector.id,
      labelFor: runSelector.labels?.[0]?.htmlFor,
      name: runSelector.name,
    }).toStrictEqual({
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

  it('exports every brand of the selected scope and filters', async () => {
    renderWithBrandScope();

    await chooseExportFormat('xlsx');

    expect(mockStartExport).toHaveBeenCalledWith({
      view: 'brand-mention-summary',
      params: { keyword: 'hotels' },
      format: 'xlsx',
    });
  });

  it('exports every appearance of the selected scope and run', async () => {
    renderWithHistoricalRun(GROUP_SCOPE_VALUE);

    await chooseExportFormat('csv', 'Export all mentions');

    expect(mockStartExport).toHaveBeenCalledWith({
      view: 'brand-appearances',
      params: {
        group_id: 'group-coruna',
        timestamp: HISTORICAL_BRAND_RUN,
      },
      format: 'csv',
    });
  });

  it('pages the brands past the first page of the summary', () => {
    mocks.useBrandMentions.mockReturnValue({
      computing: null,
      data: {
        ...brandMentionsExportResponse,
        aggregated: {
          ...brandMentionsExportResponse.aggregated,
          brands_total: 140,
          brands_next_token: 'page-2',
        },
      },
      request: {
        path: '/brand-mentions',
        params: new URLSearchParams({ keyword: 'hotels' }),
      },
      loading: false,
      error: null,
    });
    renderWithBrandScope();

    expect(screen.getByRole('button', { name: 'Load more brands' })).toBeInTheDocument();
  });
});
