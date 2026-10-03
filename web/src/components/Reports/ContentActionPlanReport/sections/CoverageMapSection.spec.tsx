import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen, within 
} from '@testing-library/react';
import { expectRendersNothing } from '../../../../test/renderNothing';
import { CoverageMapSection } from './CoverageMapSection';
import type { ContentPlanSectionProps } from './ContentPlanSectionProps';
import {
  buildBrief, buildGaps, buildIdea, fetchPlaceholderCases
} from './ContentPlanSectionProps-fixtures';

/**
 * CoverageMapSection joins three data sources keyword-by-keyword:
 * citation gaps, generated briefs (Content Studio history), and open
 * ideas. The join + sort + status-label logic is the section's reason
 * for existing — these tests pin every transition.
 */

const SHOE_GAPS = buildGaps([{
  keyword: 'shoes',
  gap_count: 3,
  high_priority_gaps: 1 
}]);

const NO_PLAN: ContentPlanSectionProps = {
  gaps: buildGaps([]),
  ideas: [],
  history: [],
  loading: false,
  error: null,
};

function renderCoverage(props: Partial<ContentPlanSectionProps>) {
  return render(<CoverageMapSection {...NO_PLAN} {...props} />);
}

function getShoeRowElement(): HTMLElement | null {
  return screen.getByText('shoes').closest('tr');
}

function getShoeCellElements(): HTMLElement[] {
  return within(getShoeRowElement() as HTMLElement).getAllByRole('cell');
}

describe('CoverageMapSection — joining gaps + briefs + ideas', () => {
  it('counts only briefs with status=generated against the briefCount column', () => {
    renderCoverage({
      gaps: SHOE_GAPS,
      history: [
        buildBrief('h1', { keyword: 'shoes' }),
        buildBrief('h2', {
          keyword: 'shoes',
          status: 'pending' 
        }),
        buildBrief('h3', {
          keyword: 'shoes',
          status: 'failed' 
        }),
      ],
    });
    expect(getShoeRowElement()).not.toBeNull();
    // Columns: keyword, gaps(3), hi-pri(1), briefs(1 — only 'generated'), ideas(0), status
    expect(getShoeCellElements()[3]).toHaveTextContent('1');
  });

  it('counts only ideas with a non-null keyword', () => {
    renderCoverage({
      gaps: SHOE_GAPS,
      ideas: [
        buildIdea('i1', { keyword: 'shoes' }),
        buildIdea('i2', { keyword: null }),
        buildIdea('i3', { keyword: 'shoes' }),
      ],
    });
    // Columns: keyword, gaps, hi-pri, briefs, ideas, status
    expect(getShoeCellElements()[4]).toHaveTextContent('2');
  });

  it('creates a row from history-only or idea-only keywords (no gaps)', () => {
    renderCoverage({
      ideas: [buildIdea('i1', { keyword: 'orphan-from-ideas' })],
      history: [buildBrief('h1', { keyword: 'orphan-from-briefs' })],
    });
    expect(screen.getByText('orphan-from-ideas')).toBeInTheDocument();
    expect(screen.getByText('orphan-from-briefs')).toBeInTheDocument();
  });
});

describe('CoverageMapSection — status labels', () => {
  const shoeGaps = buildGaps([{
    keyword: 'shoes',
    gap_count: 5,
    high_priority_gaps: 2 
  }]);
  const shoeIdeas = [buildIdea('i1', { keyword: 'shoes' })];
  const shoeBriefs = [buildBrief('h1', { keyword: 'shoes' })];

  it.each<[label: string, situation: string, props: Partial<ContentPlanSectionProps>]>([
    ['Blocked', 'gaps but no briefs and no ideas', { gaps: shoeGaps }],
    ['Planned', 'gaps + ideas but no briefs', {
      gaps: shoeGaps,
      ideas: shoeIdeas 
    }],
    ['In progress', 'gaps + briefs', {
      gaps: shoeGaps,
      history: shoeBriefs 
    }],
    ['Covered', 'no gaps but briefs', { history: shoeBriefs }],
  ])('labels the keyword %s when it has %s', (label, _situation, props) => {
    renderCoverage(props);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe('CoverageMapSection — sort + placeholder states', () => {
  it('orders blocked rows above non-blocked rows', () => {
    renderCoverage({
      gaps: buildGaps([
        {
          keyword: 'a-non-blocked',
          gap_count: 5,
          high_priority_gaps: 1 
        },
        {
          keyword: 'b-blocked',
          gap_count: 2,
          high_priority_gaps: 1 
        },
      ]),
      history: [buildBrief('h1', { keyword: 'a-non-blocked' })],
    });
    const rows = screen.getAllByRole('row');
    // Header is rows[0]; first data row should be the blocked one even though
    // alphabetically a-non-blocked sorts first.
    expect(rows[1]).toHaveTextContent('b-blocked');
    expect(rows[2]).toHaveTextContent('a-non-blocked');
  });

  it('returns null (no section rendered) when there is no data at all', () => {
    expectRendersNothing(<CoverageMapSection {...NO_PLAN} />);
  });

  it.each(fetchPlaceholderCases(/Building coverage map/i))('renders the $name', ({
    state, text
  }) => {
    renderCoverage({
      gaps: null,
      ...state,
    });
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});
