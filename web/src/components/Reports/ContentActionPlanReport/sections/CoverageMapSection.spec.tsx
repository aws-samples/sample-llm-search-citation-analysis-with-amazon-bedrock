import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen, within 
} from '@testing-library/react';
import { expectRendersNothing } from '../../../../test/renderNothing';
import { CoverageMapSection } from './CoverageMapSection';
import {
  brief, buildGaps, idea
} from './CoverageMapSection-fixtures';
import type {
  CitationGapsResponse,
  ContentIdea,
  ContentStudioHistory,
} from '../../../../types';

/**
 * CoverageMapSection joins three data sources keyword-by-keyword:
 * citation gaps, generated briefs (Content Studio history), and open
 * ideas. The join + sort + status-label logic is the section's reason
 * for existing — these tests pin every transition.
 */

describe('CoverageMapSection — joining gaps + briefs + ideas', () => {
  it('counts only briefs with status=generated against the briefCount column', () => {
    const gaps = buildGaps([{
      keyword: 'shoes',
      gap_count: 3,
      high_priority_gaps: 1 
    }]);
    const history = [
      brief('h1', 'shoes', 'generated'),
      brief('h2', 'shoes', 'pending'),
      brief('h3', 'shoes', 'failed'),
    ];
    render(
      <CoverageMapSection
        gaps={gaps}
        ideas={[]}
        history={history}
        loading={false}
        error={null}
      />,
    );
    const row = screen.getByText('shoes').closest('tr');
    expect(row).not.toBeNull();
    // Columns: keyword, gaps(3), hi-pri(1), briefs(1 — only 'generated'), ideas(0), status
    const cells = within(row as HTMLElement).getAllByRole('cell');
    expect(cells[3]).toHaveTextContent('1');
  });

  it('counts only ideas with a non-null keyword', () => {
    const gaps = buildGaps([{
      keyword: 'shoes',
      gap_count: 3,
      high_priority_gaps: 1 
    }]);
    const ideas = [
      idea('i1', 'shoes'),
      idea('i2', null),
      idea('i3', 'shoes'),
    ];
    render(
      <CoverageMapSection
        gaps={gaps}
        ideas={ideas}
        history={[]}
        loading={false}
        error={null}
      />,
    );
    const row = screen.getByText('shoes').closest('tr');
    const cells = within(row as HTMLElement).getAllByRole('cell');
    // Columns: keyword, gaps, hi-pri, briefs, ideas, status
    expect(cells[4]).toHaveTextContent('2');
  });

  it('creates a row from history-only or idea-only keywords (no gaps)', () => {
    render(
      <CoverageMapSection
        gaps={buildGaps([])}
        ideas={[idea('i1', 'orphan-from-ideas')]}
        history={[brief('h1', 'orphan-from-briefs', 'generated')]}
        loading={false}
        error={null}
      />,
    );
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

  it.each<[label: string, situation: string, gaps: CitationGapsResponse, ideas: ContentIdea[], history: ContentStudioHistory[]]>([
    ['Blocked', 'gaps but no briefs and no ideas', shoeGaps, [], []],
    ['Planned', 'gaps + ideas but no briefs', shoeGaps, [idea('i1', 'shoes')], []],
    ['In progress', 'gaps + briefs', shoeGaps, [], [brief('h1', 'shoes', 'generated')]],
    ['Covered', 'no gaps but briefs', buildGaps([]), [], [brief('h1', 'shoes', 'generated')]],
  ])('labels the keyword %s when it has %s', (label, _situation, gaps, ideas, history) => {
    render(
      <CoverageMapSection
        gaps={gaps}
        ideas={ideas}
        history={history}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe('CoverageMapSection — sort + placeholder states', () => {
  it('orders blocked rows above non-blocked rows', () => {
    const gaps = buildGaps([
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
    ]);
    render(
      <CoverageMapSection
        gaps={gaps}
        ideas={[]}
        history={[brief('h1', 'a-non-blocked', 'generated')]}
        loading={false}
        error={null}
      />,
    );
    const rows = screen.getAllByRole('row');
    // Header is rows[0]; first data row should be the blocked one even though
    // alphabetically a-non-blocked sorts first.
    expect(rows[1]).toHaveTextContent('b-blocked');
    expect(rows[2]).toHaveTextContent('a-non-blocked');
  });

  it('returns null (no section rendered) when there is no data at all', () => {
    expectRendersNothing(
      <CoverageMapSection gaps={buildGaps([])} ideas={[]} history={[]} loading={false} error={null} />,
    );
  });

  it('renders the loading placeholder when loading is true', () => {
    render(
      <CoverageMapSection
        gaps={null}
        ideas={[]}
        history={[]}
        loading
        error={null}
      />,
    );
    expect(screen.getByText(/Building coverage map/i)).toBeInTheDocument();
  });

  it('renders the error placeholder when error is set', () => {
    render(
      <CoverageMapSection
        gaps={null}
        ideas={[]}
        history={[]}
        loading={false}
        error="Backend down"
      />,
    );
    expect(screen.getByText(/Backend down/i)).toBeInTheDocument();
  });
});
