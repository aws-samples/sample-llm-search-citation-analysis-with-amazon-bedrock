import {
  render, screen 
} from '@testing-library/react';
import {
  describe, it, expect 
} from 'vitest';
import { PromptCard } from './PromptCard';
import { winningPrompt as basePrompt } from '../../hooks/usePromptInsights-fixtures';

describe('PromptCard', () => {
  it('displays keyword', () => {
    render(<PromptCard prompt={basePrompt} />);
    expect(screen.getByText('best hotels')).toBeInTheDocument();
  });

  it('displays status with winning styling', () => {
    render(<PromptCard prompt={basePrompt} />);
    expect(screen.getByText('winning')).toHaveClass('bg-gray-100', 'text-emerald-800');
  });

  it('displays status with losing styling', () => {
    render(<PromptCard prompt={{
      ...basePrompt,
      status: 'losing' 
    }} />);
    expect(screen.getByText('losing')).toHaveClass('bg-red-100', 'text-red-800');
  });

  it.each([
    ['first party mentions and rank', '10 mentions', 'Rank #1'],
    ['competitor mentions and rank', '5 mentions', 'Rank #3'],
    ['provider coverage percentages', '75% provider coverage', '50% provider coverage'],
  ])('displays %s', (_case, firstText, secondText) => {
    render(<PromptCard prompt={basePrompt} />);
    expect(screen.getByText(firstText)).toBeInTheDocument();
    expect(screen.getByText(secondText)).toBeInTheDocument();
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
