import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen, within 
} from '@testing-library/react';
import type { KeywordTrend } from '../../../../types';
import { expectRendersNothing } from '../../../../test/renderNothing';
import { MoversSection } from './MoversSection';
import {
  buildKeywordTrend, movingKeyword, trendViewOf
} from '../../layout/reportPayload-fixtures';
import {
  moverColumn, moverKeywords
} from '../../layout/reportQueries-fixtures';

function renderMovers(rows: KeywordTrend[]): void {
  render(<MoversSection trends={trendViewOf(rows)} loading={false} error={null} />);
}

describe('MoversSection columns', () => {
  it('lists an improving keyword with its score and change in the Improving column', () => {
    renderMovers([movingKeyword('up-a', 3, 'improving', 62), movingKeyword('down-a', -4, 'declining')]);

    expect(within(moverColumn('Improving')).getByRole('listitem')).toHaveTextContent('up-aScore 62.0+3.0 pts');
  });

  it('lists a declining keyword with its change in the Declining column', () => {
    renderMovers([movingKeyword('up-a', 3, 'improving'), movingKeyword('down-a', -4, 'declining')]);

    expect(within(moverColumn('Declining')).getByRole('listitem')).toHaveTextContent('down-aScore 50.0-4.0 pts');
  });

  it('orders each column by the size of the move', () => {
    renderMovers([movingKeyword('small-up', 2, 'improving'), movingKeyword('big-up', 9, 'improving')]);

    expect(moverKeywords('Improving')).toStrictEqual(['big-up', 'small-up']);
  });

  it('keeps a keyword that moved without passing the trend rule out of both columns', () => {
    renderMovers([movingKeyword('up-a', 3, 'improving'), movingKeyword('flat', -1.5, 'stable')]);

    expect([...moverKeywords('Improving'), ...moverKeywords('Declining')]).toStrictEqual(['up-a']);
  });

  it('says so in a column when no keyword moved that way', () => {
    renderMovers([movingKeyword('down-a', -3, 'declining')]);

    expect(within(moverColumn('Improving')).getByText('No keyword\'s visibility score moved this way.')).toBeInTheDocument();
  });
});

describe('MoversSection states', () => {
  it('drops out of the report when no keyword\'s visibility score moved by the trend rule', () => {
    expectRendersNothing(
      <MoversSection
        trends={trendViewOf([movingKeyword('flat', 1.9, 'stable'), buildKeywordTrend('new')])}
        loading={false}
        error={null}
      />,
    );
  });

  it('drops out of the report when there is no keyword', () => {
    expectRendersNothing(<MoversSection trends={trendViewOf([])} loading={false} error={null} />);
  });

  it('shows the loading state', () => {
    render(<MoversSection trends={null} loading error={null} />);

    expect(screen.getByText('Loading movers…')).toBeInTheDocument();
  });

  it('shows the error', () => {
    render(<MoversSection trends={null} loading={false} error="boom" />);

    expect(screen.getByText('boom')).toBeInTheDocument();
  });
});
