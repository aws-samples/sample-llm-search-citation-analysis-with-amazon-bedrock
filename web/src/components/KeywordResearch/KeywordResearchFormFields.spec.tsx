import {
  render, screen
} from '@testing-library/react';
import {
  describe, expect, it, vi
} from 'vitest';
import {
  InputForm, KeywordsTable
} from './CompetitorAnalysisComponents';
import { buildResult } from './CompetitorAnalysis-fixtures';
import { KeywordExpansion } from './KeywordExpansion';
import { buildProps } from './KeywordExpansion-fixtures';

describe('Keyword Research form fields', () => {
  it('associates the seed label with deterministic metadata when the expansion form renders', () => {
    render(<KeywordExpansion {...buildProps()} />);

    const seedField = screen.getByLabelText('Seed Keyword');
    expect(screen.getByText('Seed Keyword')).toHaveAttribute('for', 'keyword-expansion-seed');
    expect(seedField).toHaveAttribute('id', 'keyword-expansion-seed');
    expect(seedField).toHaveAttribute('name', 'seed');
  });

  it('associates the industry label with deterministic metadata when the expansion form renders', () => {
    render(<KeywordExpansion {...buildProps()} />);

    const industryField = screen.getByLabelText('Industry');
    expect(screen.getByText('Industry')).toHaveAttribute('for', 'keyword-expansion-industry');
    expect(industryField).toHaveAttribute('id', 'keyword-expansion-industry');
    expect(industryField).toHaveAttribute('name', 'industry');
  });

  it('associates the count label with deterministic metadata when the expansion form renders', () => {
    render(<KeywordExpansion {...buildProps()} />);

    const countField = screen.getByLabelText('Number of Keywords');
    expect(screen.getByText('Number of Keywords')).toHaveAttribute('for', 'keyword-expansion-count');
    expect(countField).toHaveAttribute('id', 'keyword-expansion-count');
    expect(countField).toHaveAttribute('name', 'count');
  });

  it('associates the visible URL prompt with deterministic metadata when the competitor form renders', () => {
    render(<InputForm url="" setUrl={vi.fn()} loading={false} onSubmit={vi.fn()} />);

    const competitorUrlLabel = screen.getByText("Enter a competitor's URL to discover keywords they're targeting and find content gaps.");
    const competitorUrlField = screen.getByLabelText("Enter a competitor's URL to discover keywords they're targeting and find content gaps.");
    expect(competitorUrlLabel).toBeVisible();
    expect(competitorUrlLabel).toHaveAttribute('for', 'competitor-analysis-url');
    expect(competitorUrlField).toHaveAttribute('id', 'competitor-analysis-url');
    expect(competitorUrlField).toHaveAttribute('name', 'competitor-url');
  });

  it('exposes stable metadata when competitor keyword selections render', () => {
    render(
      <KeywordsTable
        keywords={buildResult().primary_keywords}
        showOpportunity={false}
        selectable
        selected={new Set<string>()}
        onToggle={vi.fn()}
      />
    );

    const hotelSelection = screen.getByRole('checkbox', { name: 'Select hotel' });
    expect(hotelSelection).toHaveAttribute('id', 'competitor-keyword-hotel');
    expect(hotelSelection).toHaveAttribute('name', 'competitor-keywords');
    expect(hotelSelection).toHaveAttribute('value', 'hotel');
  });
});
