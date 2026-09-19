import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  fireEvent, render, screen, waitFor, within
} from '@testing-library/react';
import { renderedScopeOptionLabels } from '../ui/KeywordScopeSelector-fixtures';
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

const mocks = vi.hoisted(() => ({
  useBrandMentions: vi.fn(),
  exportBrandMentions: vi.fn(),
}));

vi.mock('../../hooks/useBrandMentions', () => ({useBrandMentions: mocks.useBrandMentions,}));

vi.mock('./brandMentionsExport', () => ({exportBrandMentions: mocks.exportBrandMentions,}));

vi.mock('../../hooks/useBrandConfig', () => ({
  useBrandConfig: vi.fn(() => ({
    config: null,
    presets: {},
    loading: false,
    saveConfig: vi.fn(),
    expandAllBrands: vi.fn(),
    findCompetitors: vi.fn(),
  })),
}));

// A bare mock, configured below: the fixtures module renders the real hook in
// its own helpers, so importing it inside this factory would wait on the very
// module being mocked.
vi.mock('../../hooks/useKeywordGroups', () => ({ useKeywordGroups: vi.fn() }));

import { BrandsView } from './BrandsView';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';
import { buildKeywordGroupsHookResult } from '../../hooks/useKeywordGroups-fixtures';

vi.mock('../Personas/PersonaSelector', () => ({
  PersonaSelector: ({
    selectedPersonaId, onPersonaChange
  }: {
    selectedPersonaId: string | null;
    onPersonaChange: (personaId: string | null) => void;
  }) => (
    <button
      type="button"
      aria-label="Choose reporting persona"
      onClick={() => onPersonaChange('persona-a')}
    >
      {selectedPersonaId ?? 'All Personas'}
    </button>
  ),
}));

describe('BrandsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useKeywordGroups).mockReturnValue(buildKeywordGroupsHookResult());
    mocks.useBrandMentions.mockReturnValue({
      data: brandMentionsExportResponse,
      loading: false,
      error: null,
    });
    mocks.exportBrandMentions.mockResolvedValue(undefined);
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

  it('offers Latest and exact run values when a scope is selected', () => {
    render(<BrandsView keywords={brandKeywordsFixture} />);
    selectBrandScope();

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

  it('passes the historical timestamp to the data hook when a run is selected', () => {
    render(<BrandsView keywords={brandKeywordsFixture} />);
    selectBrandScope();
    selectBrandRun();

    expect(mocks.useBrandMentions).toHaveBeenLastCalledWith(
      KEYWORD_REPORT_SCOPE,
      null,
      null,
      HISTORICAL_BRAND_RUN
    );
  });

  it('resets the historical run when the report scope changes', () => {
    render(<BrandsView keywords={brandKeywordsFixture} />);
    selectBrandScope();
    selectBrandRun();
    selectBrandScope(GROUP_SCOPE_VALUE);

    expect(screen.getByLabelText('Analysis run')).toHaveValue('');
    expect(mocks.useBrandMentions).toHaveBeenLastCalledWith(
      GROUP_REPORT_SCOPE,
      null,
      null,
      null
    );
  });

  it('resets the historical run when the persona changes', () => {
    render(<BrandsView keywords={brandKeywordsFixture} />);
    selectBrandScope();
    selectBrandRun();
    fireEvent.click(screen.getByRole('button', { name: 'Choose reporting persona' }));

    expect(screen.getByLabelText('Analysis run')).toHaveValue('');
    expect(mocks.useBrandMentions).toHaveBeenLastCalledWith(
      KEYWORD_REPORT_SCOPE,
      null,
      'persona-a',
      null
    );
  });

  it('labels the selected aggregate analysis run with keyword coverage', () => {
    render(<BrandsView keywords={brandKeywordsFixture} />);
    selectBrandScope(GROUP_SCOPE_VALUE);
    selectBrandRun();

    expect(screen.getByText(
      `Analysis run ${HISTORICAL_BRAND_RUN} includes data for 1 of 2 keywords in Hotel Coruña.`
    )).toBeInTheDocument();
  });

  it('exports the currently returned server response when the button is pressed', async () => {
    render(<BrandsView keywords={brandKeywordsFixture} />);
    selectBrandScope();

    fireEvent.click(screen.getByRole('button', { name: 'Export to Excel' }));

    await waitFor(() => {
      expect(mocks.exportBrandMentions).toHaveBeenCalledWith(brandMentionsExportResponse, 'hotels');
    });
  });

  it('shows the export loading state while the workbook is being generated', () => {
    mocks.exportBrandMentions.mockImplementation(() => new Promise(vi.fn()));
    render(<BrandsView keywords={brandKeywordsFixture} />);
    selectBrandScope();

    fireEvent.click(screen.getByRole('button', { name: 'Export to Excel' }));

    expect(screen.getByRole('button', { name: 'Exporting…' })).toBeDisabled();
  });
});
