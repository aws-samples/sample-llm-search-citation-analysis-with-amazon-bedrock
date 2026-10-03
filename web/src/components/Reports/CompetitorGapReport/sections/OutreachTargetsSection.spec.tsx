import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import type { CompetitorExclusiveSource } from '../../../../api/reports';
import { OutreachTargetsSection } from './OutreachTargetsSection';
import {
  buildSource, loadedRollup
} from './rollupSection-fixtures';

function renderTargets(...targets: CompetitorExclusiveSource[]) {
  return render(<OutreachTargetsSection {...loadedRollup({ outreach_targets: targets })} />);
}

describe('OutreachTargetsSection — card content', () => {
  it('renders the domain as the card heading', () => {
    renderTargets(buildSource({ domain: 'mydomain.com' }));
    expect(
      screen.getByRole('heading', {
        level: 3,
        name: 'mydomain.com' 
      }),
    ).toBeInTheDocument();
  });

  it('renders the URL beneath the domain heading', () => {
    renderTargets(buildSource({ url: 'https://example.com/specific-post' }));
    expect(screen.getByText('https://example.com/specific-post')).toBeInTheDocument();
  });

  it('renders the lift_score formatted to two decimal places', () => {
    renderTargets(buildSource({ lift_score: 6.91 }));
    expect(screen.getByText('6.91')).toBeInTheDocument();
  });

  it('renders citation_count and provider_count as separate metrics', () => {
    renderTargets(buildSource({
      citation_count: 12,
      provider_count: 4,
    }));
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });
});


describe('OutreachTargetsSection — priority badges', () => {
  it.each(['high', 'medium', 'low'] as const)('renders the %s priority badge label', (priority) => {
    renderTargets(buildSource({ priority }));
    expect(screen.getByText(priority)).toBeInTheDocument();
  });
});


describe('OutreachTargetsSection — multi-target rendering', () => {
  it('renders one card per target', () => {
    renderTargets(
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
    );
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3);
  });

  it('uses URL+keyword composite key so duplicate-URL different-keyword targets co-exist', () => {
    // Both targets share the same URL but reference different keywords —
    // they should both render rather than collide on the React key.
    renderTargets(
      buildSource({
        url: 'https://shared.com',
        keyword: 'shoes' 
      }),
      buildSource({
        url: 'https://shared.com',
        keyword: 'boots' 
      }),
    );
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2);
  });
});

describe('OutreachTargetsSection — empty state', () => {
  it('renders friendly empty copy when targets list is empty', () => {
    renderTargets();
    expect(
      screen.getByText(/No outreach targets identified/i),
    ).toBeInTheDocument();
  });
});
