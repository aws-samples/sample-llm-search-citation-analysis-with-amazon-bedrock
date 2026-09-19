import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { OutreachTargetsSection } from './OutreachTargetsSection';
import {
  buildRollup, buildSource
} from './OutreachTargetsSection-fixtures';

describe('OutreachTargetsSection — card content', () => {
  it('renders the domain as the card heading', () => {
    render(
      <OutreachTargetsSection
        rollup={buildRollup([buildSource({ domain: 'mydomain.com' })])}
        loading={false}
        error={null}
      />,
    );
    expect(
      screen.getByRole('heading', {
        level: 3,
        name: 'mydomain.com' 
      }),
    ).toBeInTheDocument();
  });

  it('renders the URL beneath the domain heading', () => {
    render(
      <OutreachTargetsSection
        rollup={buildRollup([buildSource({ url: 'https://example.com/specific-post' })])}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText('https://example.com/specific-post')).toBeInTheDocument();
  });

  it('renders the lift_score formatted to two decimal places', () => {
    render(
      <OutreachTargetsSection
        rollup={buildRollup([buildSource({ lift_score: 6.91 })])}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText('6.91')).toBeInTheDocument();
  });

  it('renders citation_count and provider_count as separate metrics', () => {
    render(
      <OutreachTargetsSection
        rollup={buildRollup([buildSource({
          citation_count: 12,
          provider_count: 4,
        })])}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });
});


describe('OutreachTargetsSection — priority badges', () => {
  it('renders the high priority badge label', () => {
    render(
      <OutreachTargetsSection
        rollup={buildRollup([buildSource({ priority: 'high' })])}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText('high')).toBeInTheDocument();
  });

  it('renders the medium priority badge label', () => {
    render(
      <OutreachTargetsSection
        rollup={buildRollup([buildSource({ priority: 'medium' })])}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText('medium')).toBeInTheDocument();
  });

  it('renders the low priority badge label', () => {
    render(
      <OutreachTargetsSection
        rollup={buildRollup([buildSource({ priority: 'low' })])}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText('low')).toBeInTheDocument();
  });
});


describe('OutreachTargetsSection — multi-target rendering', () => {
  it('renders one card per target', () => {
    render(
      <OutreachTargetsSection
        rollup={buildRollup([
          buildSource({
            url: 'https://a.com/x',
            domain: 'a.com' 
          }),
          buildSource({
            url: 'https://b.com/y',
            domain: 'b.com' 
          }),
          buildSource({
            url: 'https://c.com/z',
            domain: 'c.com' 
          }),
        ])}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3);
  });

  it('uses URL+keyword composite key so duplicate-URL different-keyword targets co-exist', () => {
    // Both targets share the same URL but reference different keywords —
    // they should both render rather than collide on the React key.
    render(
      <OutreachTargetsSection
        rollup={buildRollup([
          buildSource({
            url: 'https://shared.com',
            keyword: 'shoes' 
          }),
          buildSource({
            url: 'https://shared.com',
            keyword: 'boots' 
          }),
        ])}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2);
  });
});

describe('OutreachTargetsSection — empty + placeholder states', () => {
  it('renders friendly empty copy when targets list is empty', () => {
    render(
      <OutreachTargetsSection
        rollup={buildRollup([])}
        loading={false}
        error={null}
      />,
    );
    expect(
      screen.getByText(/No outreach targets identified/i),
    ).toBeInTheDocument();
  });

  it('returns null when rollup is null', () => {
    const { container } = render(
      <OutreachTargetsSection rollup={null} loading={false} error={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders loading placeholder when loading is true', () => {
    render(<OutreachTargetsSection rollup={null} loading error={null} />);
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it('renders error message when error is set', () => {
    render(
      <OutreachTargetsSection rollup={null} loading={false} error="boom" />,
    );
    expect(screen.getByText('boom')).toBeInTheDocument();
  });
});
