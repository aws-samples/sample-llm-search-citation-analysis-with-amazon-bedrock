import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen, within 
} from '@testing-library/react';
import { WinsAndGapsSection } from './WinsAndGapsSection';
import {
  buildMover, buildOverview
} from './reportsOverview-fixtures';

describe('WinsAndGapsSection — content rendering', () => {
  it('renders improvers in the Wins column with their change values', () => {
    render(
      <WinsAndGapsSection
        data={buildOverview({ improving: [buildMover('best running shoes', 8, 'improving')] })}
        loading={false}
        error={null}
      />,
    );
    const winsHeading = screen.getByRole('heading', { name: 'Wins' });
    const winsColumn = winsHeading.closest('div');
    expect(within(winsColumn as HTMLElement).getByText('best running shoes'))
      .toBeInTheDocument();
    expect(within(winsColumn as HTMLElement).getByText('+8.0'))
      .toBeInTheDocument();
  });

  it('renders decliners in the Gaps column without a plus sign', () => {
    render(
      <WinsAndGapsSection
        data={buildOverview({ declining: [buildMover('best hiking boots', -10, 'declining')] })}
        loading={false}
        error={null}
      />,
    );
    const gapsHeading = screen.getByRole('heading', { name: 'Gaps' });
    const gapsColumn = gapsHeading.closest('div');
    expect(within(gapsColumn as HTMLElement).getByText('best hiking boots'))
      .toBeInTheDocument();
    expect(within(gapsColumn as HTMLElement).getByText('-10.0'))
      .toBeInTheDocument();
  });
});

describe('WinsAndGapsSection — empty-side messaging', () => {
  it('shows the no-improvers copy when there are no top-improving entries', () => {
    render(
      <WinsAndGapsSection
        data={buildOverview({ declining: [buildMover('declining-kw', -5, 'declining')] })}
        loading={false}
        error={null}
      />,
    );
    expect(
      screen.getByText(/should focus on the gaps panel/i),
    ).toBeInTheDocument();
  });

  it('shows the no-decliners copy when there are no top-declining entries', () => {
    render(
      <WinsAndGapsSection
        data={buildOverview({ improving: [buildMover('improving-kw', 5, 'improving')] })}
        loading={false}
        error={null}
      />,
    );
    expect(
      screen.getByText(/Maintain current investment/i),
    ).toBeInTheDocument();
  });
});

describe('WinsAndGapsSection — placeholder states', () => {
  it('returns null when data is null', () => {
    const { container } = render(
      <WinsAndGapsSection data={null} loading={false} error={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the loading placeholder when loading is true', () => {
    render(<WinsAndGapsSection data={null} loading error={null} />);
    expect(screen.getByText(/Loading movers/i)).toBeInTheDocument();
  });

  it('renders the error message when error is set', () => {
    render(<WinsAndGapsSection data={null} loading={false} error="boom" />);
    expect(screen.getByText('boom')).toBeInTheDocument();
  });
});
