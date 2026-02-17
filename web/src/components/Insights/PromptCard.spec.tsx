import {
  render, screen 
} from '@testing-library/react';
import {
  describe, it, expect 
} from 'vitest';
import { PromptCard } from './PromptCard';
import type { PromptInsight } from '../../types';

const basePrompt: PromptInsight = {
  keyword: 'best hotels',
  timestamp: '2026-01-24T00:00:00Z',
  status: 'winning',
  first_party: {
    mentions: 10,
    best_rank: 1,
    provider_coverage: 75,
    providers: ['openai'] 
  },
  competitors: {
    mentions: 5,
    best_rank: 3,
    provider_coverage: 50,
    providers: ['perplexity'] 
  },
  total_providers: 4,
};

describe('PromptCard', () => {
  it('displays keyword', () => {
    render(<PromptCard prompt={basePrompt} />);
    expect(screen.getByText('best hotels')).toBeInTheDocument();
  });

  it('displays status with winning styling', () => {
    render(<PromptCard prompt={basePrompt} />);
    expect(screen.getByText('winning')).toHaveClass('bg-green-100', 'text-green-800');
  });

  it('displays status with losing styling', () => {
    render(<PromptCard prompt={{
      ...basePrompt,
      status: 'losing' 
    }} />);
    expect(screen.getByText('losing')).toHaveClass('bg-red-100', 'text-red-800');
  });

  it('displays first party mentions and rank', () => {
    render(<PromptCard prompt={basePrompt} />);
    expect(screen.getByText('10 mentions')).toBeInTheDocument();
    expect(screen.getByText('Rank #1')).toBeInTheDocument();
  });

  it('displays competitor mentions and rank', () => {
    render(<PromptCard prompt={basePrompt} />);
    expect(screen.getByText('5 mentions')).toBeInTheDocument();
    expect(screen.getByText('Rank #3')).toBeInTheDocument();
  });

  it('displays provider coverage percentages', () => {
    render(<PromptCard prompt={basePrompt} />);
    expect(screen.getByText('75% provider coverage')).toBeInTheDocument();
    expect(screen.getByText('50% provider coverage')).toBeInTheDocument();
  });

  it('displays score when provided', () => {
    render(<PromptCard prompt={{
      ...basePrompt,
      score: 85 
    }} />);
    expect(screen.getByText('85')).toBeInTheDocument();
  });

  it('displays improvement potential when provided', () => {
    render(<PromptCard prompt={{
      ...basePrompt,
      improvement_potential: 25 
    }} />);
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('displays opportunity score when provided', () => {
    render(<PromptCard prompt={{
      ...basePrompt,
      opportunity_score: 42 
    }} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });
});
