import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { NextActionsSection } from './NextActionsSection';
import {
  buildOverview, buildRec
} from './reportsOverview-fixtures';

describe('NextActionsSection — content', () => {
  it('renders each recommendation title as an h3', () => {
    render(
      <NextActionsSection
        data={buildOverview({
          recommendations: [
            buildRec('First action', 'high'),
            buildRec('Second action', 'medium'),
          ],
        })}
        loading={false}
        error={null}
      />,
    );
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
    render(
      <NextActionsSection
        data={buildOverview({
          recommendations: [
            buildRec('Pitch publishers', 'high', {
              description: 'Outdoor outlets cite competitors only.',
              action: 'Reach out to Outside, Backpacker, REI Co-op Journal',
              impact: '5-10% visibility lift',
            }),
          ],
        })}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText('Outdoor outlets cite competitors only.'))
      .toBeInTheDocument();
    expect(screen.getByText('Reach out to Outside, Backpacker, REI Co-op Journal'))
      .toBeInTheDocument();
    expect(screen.getByText('5-10% visibility lift')).toBeInTheDocument();
  });

  it('renders the priority label as a badge', () => {
    render(
      <NextActionsSection
        data={buildOverview({ recommendations: [buildRec('Action A', 'high')] })}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText('high')).toBeInTheDocument();
  });
});

describe('NextActionsSection — empty + placeholder states', () => {
  it.each([
    ['data is null', null],
    ['data exists but recommendations array is empty', buildOverview()],
  ])('renders the empty copy when %s', (_label, data) => {
    render(
      <NextActionsSection
        data={data}
        loading={false}
        error={null}
      />,
    );
    expect(
      screen.getByText(/visibility plan is on track/i),
    ).toBeInTheDocument();
  });

  it('renders the loading placeholder when loading is true', () => {
    render(<NextActionsSection data={null} loading error={null} />);
    expect(screen.getByText(/Loading recommendations/i)).toBeInTheDocument();
  });

  it('renders the error message when error is set', () => {
    render(<NextActionsSection data={null} loading={false} error="boom" />);
    expect(screen.getByText('boom')).toBeInTheDocument();
  });
});
