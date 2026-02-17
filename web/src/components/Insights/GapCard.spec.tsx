import {
  render, screen 
} from '@testing-library/react';
import {
  describe, it, expect 
} from 'vitest';
import { GapCard } from './GapCard';
import type { CitationGap } from '../../types';

const baseGap: CitationGap = {
  url: 'https://example.com/article',
  title: 'Test Article',
  domain: 'example.com',
  priority: 'high',
  citation_count: 5,
  provider_count: 3,
  competitor_brands: [],
  providers: ['openai', 'perplexity', 'gemini'],
  first_party_brands: [],
  gap_type: 'competitor_only',
};

describe('GapCard', () => {
  it('displays title as link when provided', () => {
    render(<GapCard gap={baseGap} />);
    const link = screen.getByRole('link', { name: 'Test Article' });
    expect(link).toHaveAttribute('href', 'https://example.com/article');
  });

  it('displays URL as link text when title is missing', () => {
    render(<GapCard gap={{
      ...baseGap,
      title: undefined 
    }} />);
    expect(screen.getByRole('link', { name: 'https://example.com/article' })).toBeInTheDocument();
  });

  it('displays domain', () => {
    render(<GapCard gap={baseGap} />);
    expect(screen.getByText('example.com')).toBeInTheDocument();
  });

  it('displays citation and provider counts', () => {
    render(<GapCard gap={baseGap} />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('applies high priority styling', () => {
    render(<GapCard gap={baseGap} />);
    expect(screen.getByText('high')).toHaveClass('bg-red-100', 'text-red-800');
  });

  it('applies medium priority styling', () => {
    render(<GapCard gap={{
      ...baseGap,
      priority: 'medium' 
    }} />);
    expect(screen.getByText('medium')).toHaveClass('bg-yellow-100', 'text-yellow-800');
  });

  it('displays competitor brands when present', () => {
    render(<GapCard gap={{
      ...baseGap,
      competitor_brands: ['Competitor A', 'Competitor B'] 
    }} />);
    expect(screen.getByText('Competitor A')).toBeInTheDocument();
    expect(screen.getByText('Competitor B')).toBeInTheDocument();
  });

  it('hides competitor section when no competitors', () => {
    render(<GapCard gap={baseGap} />);
    expect(screen.queryByText('Competitors mentioned:')).not.toBeInTheDocument();
  });

  it('displays keyword when provided', () => {
    render(<GapCard gap={{
      ...baseGap,
      keyword: 'test keyword' 
    }} />);
    expect(screen.getByText('Keyword: test keyword')).toBeInTheDocument();
  });
});
