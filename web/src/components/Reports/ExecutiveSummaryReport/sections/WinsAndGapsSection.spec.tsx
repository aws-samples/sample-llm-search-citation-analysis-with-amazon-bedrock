import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen, within 
} from '@testing-library/react';
import type { ReportsOverviewResponse } from '../../../../api/reports';
import { expectRendersNothing } from '../../../../test/renderNothing';
import { WinsAndGapsSection } from './WinsAndGapsSection';
import { buildMover } from '../../layout/reportPayload-fixtures';
import {
  moverColumn, moverKeywords, sectionTitled
} from '../../layout/reportQueries-fixtures';
import { loadedOverview } from './reportsOverview-fixtures';
import { sectionPlaceholderCases } from '../../layout/sectionGate-fixtures';

function renderWinsAndGaps(overrides: Partial<ReportsOverviewResponse>): void {
  render(<WinsAndGapsSection {...loadedOverview(overrides)} />);
}

describe('WinsAndGapsSection — content rendering', () => {
  it('lists an improver in the Wins column with its visibility score and change in points', () => {
    renderWinsAndGaps({ top_improving: [buildMover('best running shoes', 8, 80)] });

    expect(within(moverColumn('Wins')).getByRole('listitem')).toHaveTextContent('best running shoesScore 80.0+8.0 pts');
  });

  it('lists a decliner in the Gaps column with its fall in points', () => {
    renderWinsAndGaps({ top_declining: [buildMover('best hiking boots', -10, 30)] });

    expect(within(moverColumn('Gaps')).getByRole('listitem')).toHaveTextContent('best hiking bootsScore 30.0-10.0 pts');
  });

  it('keeps the order of the API, largest move first', () => {
    renderWinsAndGaps({ top_improving: [buildMover('big', 9), buildMover('small', 2)] });

    expect(moverKeywords('Wins')).toStrictEqual(['big', 'small']);
  });

  it('names the period the movers are measured over', () => {
    renderWinsAndGaps({ period_type: 'week' });

    expect(screen.getByText(/rose or fell the most since their previous week\./)).toBeInTheDocument();
  });

  it('starts the second printed page, after the headline and its charts', () => {
    renderWinsAndGaps({});

    expect(sectionTitled('Top wins and gaps')).toHaveClass('page-break-before');
  });
});

describe('WinsAndGapsSection — empty-side messaging', () => {
  it('shows the no-improvers copy when there are no top-improving entries', () => {
    renderWinsAndGaps({ top_declining: [buildMover('declining-kw', -5)] });

    expect(screen.getByText(/should focus on the gaps panel/i)).toBeInTheDocument();
  });

  it('shows the no-decliners copy when there are no top-declining entries', () => {
    renderWinsAndGaps({ top_improving: [buildMover('improving-kw', 5)] });

    expect(screen.getByText(/Maintain current investment/i)).toBeInTheDocument();
  });
});

describe('WinsAndGapsSection — placeholder states', () => {
  it('returns null when data is null', () => {
    expectRendersNothing(<WinsAndGapsSection data={null} loading={false} error={null} />);
  });

  it.each(sectionPlaceholderCases(/Loading movers/i))('renders the $name', ({
    state, text
  }) => {
    render(<WinsAndGapsSection data={null} {...state} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});
