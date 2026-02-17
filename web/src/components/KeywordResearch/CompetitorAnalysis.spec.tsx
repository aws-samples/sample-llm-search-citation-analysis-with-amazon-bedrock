import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompetitorAnalysis } from './CompetitorAnalysis';
import type { CompetitorAnalysisResult } from '../../types';

function buildResult(overrides: Partial<CompetitorAnalysisResult> = {}): CompetitorAnalysisResult {
  return {
    id: 'test-id',
    url: 'https://competitor.com',
    domain: 'competitor.com',
    industry: 'hospitality',
    primary_keywords: [{
      keyword: 'hotel',
      intent: 'transactional',
      competition: 'high',
      relevance: 0.9 
    }, {
      keyword: 'resort',
      intent: 'transactional',
      competition: 'medium',
      relevance: 0.8 
    }],
    secondary_keywords: [{
      keyword: 'vacation',
      intent: 'informational',
      competition: 'low',
      relevance: 0.7 
    }, {
      keyword: 'travel',
      intent: 'informational',
      competition: 'low',
      relevance: 0.6 
    }],
    longtail_keywords: [{
      keyword: 'luxury beach resort',
      intent: 'transactional',
      competition: 'low',
      relevance: 0.85 
    }],
    content_gaps: [],
    keyword_count: 5,
    ...overrides,
  };
}

describe('CompetitorAnalysis', () => {
  const defaultProps = {
    onAnalyze: vi.fn(),
    loading: false,
    result: null,
    error: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('input form', () => {
    it('renders URL input field', () => {
      render(<CompetitorAnalysis {...defaultProps} />);

      expect(screen.getByPlaceholderText('https://competitor.com')).toBeInTheDocument();
    });

    it('calls onAnalyze with URL when form submitted', async () => {
      const onAnalyze = vi.fn();
      render(<CompetitorAnalysis {...defaultProps} onAnalyze={onAnalyze} />);

      await userEvent.type(screen.getByPlaceholderText('https://competitor.com'), 'https://test.com');
      await userEvent.click(screen.getByRole('button', { name: /analyze/i }));

      expect(onAnalyze).toHaveBeenCalledWith('https://test.com');
    });

    it('does not call onAnalyze when URL is empty', async () => {
      const onAnalyze = vi.fn();
      render(<CompetitorAnalysis {...defaultProps} onAnalyze={onAnalyze} />);

      await userEvent.click(screen.getByRole('button', { name: /analyze/i }));

      expect(onAnalyze).not.toHaveBeenCalled();
    });
  });

  describe('error state', () => {
    it('displays error message when error prop is set', () => {
      render(<CompetitorAnalysis {...defaultProps} error="Invalid URL" />);

      expect(screen.getByText('Invalid URL')).toBeInTheDocument();
    });
  });

  describe('results display', () => {
    it('displays keyword count summary when result is present', () => {
      render(<CompetitorAnalysis {...defaultProps} result={buildResult()} />);

      expect(screen.getByText('Total Keywords')).toBeInTheDocument();
    });

    it('displays section tabs when result is present', () => {
      render(<CompetitorAnalysis {...defaultProps} result={buildResult()} />);

      // Check for the mobile-visible tab labels
      expect(screen.getByText('Primary')).toBeInTheDocument();
      expect(screen.getByText('Secondary')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('disables analyze button when loading', () => {
      render(<CompetitorAnalysis {...defaultProps} loading={true} />);

      expect(screen.getByRole('button', { name: /analyzing/i })).toBeDisabled();
    });
  });
});
