import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import type { ReportsOverviewResponse } from '../../../../api/reports';
import type { ReportSlice } from '../../layout';
import { NextActionsSection } from './NextActionsSection';
import {
  buildRec, loadedOverview
} from './reportsOverview-fixtures';
import { sectionPlaceholderCases } from '../../layout/sectionGate-fixtures';
import { buildOverview } from '../../layout/reportPayload-fixtures';
import { sectionTitled } from '../../layout/reportQueries-fixtures';

function renderNextActions(slice: ReportSlice<ReportsOverviewResponse>) {
  return render(<NextActionsSection {...slice} />);
}

describe('NextActionsSection — content', () => {
  it('renders each recommendation title as an h3', () => {
    renderNextActions(loadedOverview({
      top_recommendations: [
        buildRec('First action', 'high'),
        buildRec('Second action', 'medium'),
      ],
    }));
    expect(screen.getByRole('heading', {
      level: 3,
      name: 'First action' 
    }))
      .toBeInTheDocument();
    expect(screen.getByRole('heading', {
      level: 3,
      name: 'Second action' 
    }))
      .toBeInTheDocument();
  });

  it('renders the description, action, and impact for a recommendation', () => {
    renderNextActions(loadedOverview({
      top_recommendations: [
        buildRec('Pitch publishers', 'high', {
          description: 'Outdoor outlets cite competitors only.',
          action: 'Reach out to Outside, Backpacker, REI Co-op Journal',
          impact: '5-10% visibility lift',
        }),
      ],
    }));
    expect(screen.getByText('Outdoor outlets cite competitors only.'))
      .toBeInTheDocument();
    expect(screen.getByText('Reach out to Outside, Backpacker, REI Co-op Journal'))
      .toBeInTheDocument();
    expect(screen.getByText('5-10% visibility lift')).toBeInTheDocument();
  });

  it('renders the priority label as a badge', () => {
    renderNextActions(loadedOverview({ top_recommendations: [buildRec('Action A', 'high')] }));
    expect(screen.getByText('high')).toBeInTheDocument();
  });

  it('shares the printed page of the wins and gaps instead of starting a new one', () => {
    renderNextActions(loadedOverview({ top_recommendations: [buildRec('Refresh the spa page', 'low')] }));

    expect(sectionTitled('Next actions')).not.toHaveClass('page-break-before');
  });
});

describe('NextActionsSection — empty + placeholder states', () => {
  it.each([
    ['data is null', null],
    ['data exists but recommendations array is empty', buildOverview()],
  ])('renders the empty copy when %s', (_label, data) => {
    renderNextActions({
      data,
      loading: false,
      error: null,
    });
    expect(
      screen.getByText(/visibility plan is on track/i),
    ).toBeInTheDocument();
  });

  it.each(sectionPlaceholderCases(/Loading recommendations/i))('renders the $name', ({
    state, text
  }) => {
    renderNextActions({
      data: null,
      ...state,
    });
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});
