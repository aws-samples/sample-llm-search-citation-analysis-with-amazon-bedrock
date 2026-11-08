import {
  describe, it, expect, vi
} from 'vitest';
import {
  render, screen, within
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  SeoGeoReport, seoGeoMarketNote
} from './SeoGeoReport';
import {
  NO_AIO_RUN_NOTE, SeoGeoQuadrantSection 
} from './sections/SeoGeoQuadrantSection';
import { SeoGeoTableSection } from './sections/SeoGeoTableSection';
import {
  BEYOND_TOP_ROW, buildSeoGeoResponse, buildSeoGeoRow, buildSeoGeoState, NO_DATA_ROW, NOT_DEPLOYED_STATE
} from '../../../hooks/useSeoGeo-fixtures';
import { buildKeywordGroupsHookResult } from '../../../hooks/useKeywordGroups-fixtures';
import { useSeoGeo } from '../../../hooks/useSeoGeo';
import { useKeywordGroups } from '../../../hooks/useKeywordGroups';

vi.mock('../../../hooks/useSeoGeo', () => ({ useSeoGeo: vi.fn() }));
vi.mock('../../../hooks/useKeywordGroups');
vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));
vi.mock('../../../hooks/usePrintMode', () => ({ usePrintMode: vi.fn(() => ({ isPrintMode: false })) }));

function renderReportAt(path: string) {
  vi.mocked(useKeywordGroups).mockReturnValue(buildKeywordGroupsHookResult([]));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SeoGeoReport />
    </MemoryRouter>,
  );
}

function getTileElement(label: string): HTMLElement {
  // A missing card leaves an empty element, so the count query fails.
  return screen.getByRole('button', { name: `About ${label}` }).closest('div') ?? document.createElement('div');
}

describe('SeoGeoQuadrantSection', () => {
  it.each([
    ['Both strong', '4'],
    ['AI gap', '3'],
    ['SEO gap', '2'],
    ['Both weak', '1'],
    ['No data', '7'],
  ])('shows the %s count of the response', (label, count) => {
    render(<SeoGeoQuadrantSection state={buildSeoGeoState()} />);

    expect(within(getTileElement(label)).getByText(count)).toBeInTheDocument();
  });

  it('asks for keywords when the scope has none', () => {
    render(<SeoGeoQuadrantSection state={buildSeoGeoState({ data: buildSeoGeoResponse({ rows: [] }) })} />);

    expect(screen.getByText(/No active keyword in this market and scope yet/)).toBeInTheDocument();
  });

  it('says the SEO stack is not deployed instead of fetching', () => {
    render(<SeoGeoQuadrantSection state={NOT_DEPLOYED_STATE} />);

    expect(screen.getByText(/The SEO stack is not deployed/)).toBeInTheDocument();
  });

  it('explains why every keyword has no data when no run has an AI Overviews result', () => {
    const data = buildSeoGeoResponse({
      rows: [NO_DATA_ROW],
      summary: {
        both_strong: 0,
        ai_gap: 0,
        seo_gap: 0,
        both_weak: 0,
        no_data: 1,
      },
    });

    render(<SeoGeoQuadrantSection state={buildSeoGeoState({ data })} />);

    expect(screen.getByText(NO_AIO_RUN_NOTE)).toBeInTheDocument();
  });

  it('shows no AI Overviews note when some keyword has data', () => {
    render(<SeoGeoQuadrantSection state={buildSeoGeoState()} />);

    expect(screen.queryByText(NO_AIO_RUN_NOTE)).not.toBeInTheDocument();
  });
});

describe('SeoGeoTableSection', () => {
  it('shows >10 for a keyword whose domains are not in the organic top 10', () => {
    render(<SeoGeoTableSection state={buildSeoGeoState({ data: buildSeoGeoResponse({ rows: [BEYOND_TOP_ROW] }) })} />);

    const row = screen.getByRole('row', { name: /example air lounge access/ });

    expect(within(row).getByText('>10')).toBeInTheDocument();
  });

  it('shows a dash for the organic position of a keyword without a results page', () => {
    render(<SeoGeoTableSection state={buildSeoGeoState({ data: buildSeoGeoResponse({ rows: [NO_DATA_ROW] }) })} />);

    const row = screen.getByRole('row', { name: /example air baggage/ });

    expect(within(row).queryByText('>10')).not.toBeInTheDocument();
  });

  it('keeps the rows in the order the API returns them', () => {
    const rows = [buildSeoGeoRow({
      keyword_id: 'b',
      keyword: 'zeta keyword',
    }), buildSeoGeoRow({
      keyword_id: 'a',
      keyword: 'alpha keyword',
    })];
    render(<SeoGeoTableSection state={buildSeoGeoState({ data: buildSeoGeoResponse({ rows }) })} />);

    const keywords = screen.getAllByRole('row').slice(1).map((row) => row.firstElementChild?.textContent);

    expect(keywords).toStrictEqual(['zeta keyword', 'alpha keyword']);
  });

  it('labels each keyword with its quadrant', () => {
    render(<SeoGeoTableSection state={buildSeoGeoState({ data: buildSeoGeoResponse({ rows: [buildSeoGeoRow()] }) })} />);

    expect(within(screen.getByRole('row', { name: /cheap flights geneva/ })).getByText('AI gap')).toBeInTheDocument();
  });
});

describe('SeoGeoReport', () => {
  it('shows one not-deployed notice when the SEO stack is not deployed', () => {
    vi.mocked(useSeoGeo).mockReturnValue(NOT_DEPLOYED_STATE);

    renderReportAt('/reports/seo-geo');

    expect(screen.getAllByText(/The SEO stack is not deployed/)).toHaveLength(1);
  });

  it.each([
    ['the keyword group in the URL', '/reports/seo-geo?group=group-geneva', 'group-geneva'],
    ['every keyword without a group in the URL', '/reports/seo-geo', null],
  ])('reads %s', (_case, path, groupId) => {
    vi.mocked(useSeoGeo).mockReturnValue(buildSeoGeoState());

    renderReportAt(path);

    expect(useSeoGeo).toHaveBeenCalledWith(groupId);
  });

  it('titles the page SEO vs GEO', () => {
    vi.mocked(useSeoGeo).mockReturnValue(buildSeoGeoState());

    renderReportAt('/reports/seo-geo');

    expect(screen.getByRole('heading', {
      level: 1,
      name: 'SEO vs GEO',
    })).toBeInTheDocument();
  });
});

describe('seoGeoMarketNote', () => {
  it('names the header market when one is chosen', () => {
    expect(seoGeoMarketNote('Spain (Spanish)')).toBe('Keywords of Spain (Spanish).');
  });

  it('says every market combined covers the keywords without a market', () => {
    expect(seoGeoMarketNote(null)).toBe('Keywords without a market; pick a market in the header for its keywords (Google results are per country).');
  });
});
