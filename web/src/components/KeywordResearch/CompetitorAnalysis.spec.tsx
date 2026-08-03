import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompetitorAnalysis } from './CompetitorAnalysis';
import { SELECTION_LIMIT } from '../../hooks/usePromoteKeywords';
import type {
  CompetitorAnalysisResult, ExpandedKeywordWithSource 
} from '../../types';

vi.mock('../../api/client', () => ({ apiPost: vi.fn() }));

import { apiPost } from '../../api/client';

const mockApiPost = apiPost as ReturnType<typeof vi.fn>;

const promotionEndpoint = '/keywords/promote';

/**
 * A competitor result with all four sections populated by distinguishable
 * keywords, so a section switch is observable and every row carries the
 * research context (`intent` / `competition` / `source`) that must survive into
 * the promotion payload.
 */
const competitorResultFixture: CompetitorAnalysisResult = {
  id: 'competitor-1',
  url: 'https://competitor.com',
  domain: 'competitor.com',
  industry: 'hospitality',
  primary_keywords: [
    {
      keyword: 'primary beach hotel',
      intent: 'transactional',
      competition: 'high',
      relevance: 9,
      source: 'title',
    },
    {
      keyword: 'primary island resort',
      intent: 'commercial',
      competition: 'medium',
      relevance: 8,
      source: 'h1',
    },
  ],
  secondary_keywords: [
    {
      keyword: 'secondary family vacation',
      intent: 'informational',
      competition: 'low',
      relevance: 7,
      source: 'h2',
    },
    {
      keyword: 'secondary travel guide',
      intent: 'informational',
      competition: 'low',
      relevance: 6,
      source: 'meta_description',
    },
    {
      keyword: 'secondary weekend break',
      intent: 'commercial',
      competition: 'medium',
      relevance: 5,
      source: 'h3',
    },
  ],
  longtail_keywords: [
    {
      keyword: 'longtail luxury beach resort with spa',
      intent: 'transactional',
      competition: 'low',
      relevance: 8,
      source: 'body',
    },
  ],
  content_gaps: [
    {
      keyword: 'gap sustainable tourism',
      intent: 'informational',
      competition: 'low',
      relevance: 7,
      opportunity: 'no sustainability content published',
      source: 'gap-analysis',
    },
    {
      keyword: 'gap pet friendly stay',
      intent: 'commercial',
      competition: 'medium',
      relevance: 6,
      opportunity: 'competitor ignores pet travellers',
      source: 'gap-analysis',
    },
  ],
  keyword_count: 8,
};

/** A second analysis result, used to observe the clear on a new result. */
const refreshedCompetitorResultFixture: CompetitorAnalysisResult = {
  ...competitorResultFixture,
  id: 'competitor-2',
  url: 'https://rival.com',
  domain: 'rival.com',
  primary_keywords: [
    {
      keyword: 'refreshed mountain lodge',
      intent: 'transactional',
      competition: 'high',
      relevance: 9,
      source: 'title',
    },
  ],
  keyword_count: 7,
};

const sectionFixtures = [
  {
    sectionLabel: 'primary',
    tabName: /Primary Keywords/,
    keywords: competitorResultFixture.primary_keywords,
    expectedOpportunityHeaders: 0,
  },
  {
    sectionLabel: 'secondary',
    tabName: /Secondary Keywords/,
    keywords: competitorResultFixture.secondary_keywords,
    expectedOpportunityHeaders: 0,
  },
  {
    sectionLabel: 'longtail',
    tabName: /Long-tail Keywords/,
    keywords: competitorResultFixture.longtail_keywords,
    expectedOpportunityHeaders: 0,
  },
  {
    sectionLabel: 'gaps',
    tabName: /Content Gaps/,
    keywords: competitorResultFixture.content_gaps,
    expectedOpportunityHeaders: 1,
  },
];

const [firstPrimaryKeyword, secondPrimaryKeyword] = competitorResultFixture.primary_keywords;

const promotionResponseFixture = {
  created: 2,
  skipped: 0,
  created_keywords: [
    {
      id: 'keyword-1',
      keyword: firstPrimaryKeyword.keyword,
    },
    {
      id: 'keyword-2',
      keyword: secondPrimaryKeyword.keyword,
    },
  ],
  skipped_keywords: [],
};

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

  describe('promotion selection', () => {
    it.each(sectionFixtures)(
      'renders one selection checkbox per keyword row in the $sectionLabel section',
      async ({
        tabName, keywords, expectedOpportunityHeaders 
      }) => {
        render(<CompetitorAnalysis {...defaultProps} result={competitorResultFixture} />);

        await userEvent.click(screen.getByRole('button', { name: tabName }));

        expect(screen.getAllByRole('checkbox')).toHaveLength(keywords.length);
        expect(
          keywords.map((kw) => screen.getByRole('checkbox', { name: `Select ${kw.keyword}` }))
        ).toHaveLength(keywords.length);
        expect(screen.queryAllByRole('columnheader', { name: 'Opportunity' })).toHaveLength(
          expectedOpportunityHeaders
        );
      }
    );

    it('displays a selected count equal to the number of selected keywords', async () => {
      render(<CompetitorAnalysis {...defaultProps} result={competitorResultFixture} />);

      await userEvent.click(
        screen.getByRole('checkbox', { name: `Select ${firstPrimaryKeyword.keyword}` })
      );
      await userEvent.click(
        screen.getByRole('checkbox', { name: `Select ${secondPrimaryKeyword.keyword}` })
      );

      expect(screen.getByText(`2 of ${SELECTION_LIMIT} keywords selected`)).toBeInTheDocument();
      expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(2);
    });

    it('clears the selection when the active section changes', async () => {
      render(<CompetitorAnalysis {...defaultProps} result={competitorResultFixture} />);
      await userEvent.click(
        screen.getByRole('checkbox', { name: `Select ${firstPrimaryKeyword.keyword}` })
      );

      await userEvent.click(screen.getByRole('button', { name: /Secondary Keywords/ }));

      expect(screen.getByText(`0 of ${SELECTION_LIMIT} keywords selected`)).toBeInTheDocument();
      expect(screen.queryAllByRole('checkbox', { checked: true })).toHaveLength(0);
      expect(screen.getByRole('button', { name: 'Promote selected' })).toBeDisabled();
    });

    it('leaves the switched-back section unselected after a section change', async () => {
      render(<CompetitorAnalysis {...defaultProps} result={competitorResultFixture} />);
      await userEvent.click(
        screen.getByRole('checkbox', { name: `Select ${firstPrimaryKeyword.keyword}` })
      );
      await userEvent.click(screen.getByRole('button', { name: /Content Gaps/ }));

      await userEvent.click(screen.getByRole('button', { name: /Primary Keywords/ }));

      expect(
        screen.getByRole('checkbox', { name: `Select ${firstPrimaryKeyword.keyword}` })
      ).not.toBeChecked();
      expect(screen.getByText(`0 of ${SELECTION_LIMIT} keywords selected`)).toBeInTheDocument();
    });

    it('clears the selection when a new analysis result arrives', async () => {
      const { rerender } = render(
        <CompetitorAnalysis {...defaultProps} result={competitorResultFixture} />
      );
      await userEvent.click(
        screen.getByRole('checkbox', { name: `Select ${firstPrimaryKeyword.keyword}` })
      );

      rerender(<CompetitorAnalysis {...defaultProps} result={refreshedCompetitorResultFixture} />);

      expect(screen.getByText(`0 of ${SELECTION_LIMIT} keywords selected`)).toBeInTheDocument();
      expect(screen.queryAllByRole('checkbox', { checked: true })).toHaveLength(0);
    });

    it('sends a single promotion request with the selected keywords, status, and priority', async () => {
      mockApiPost.mockResolvedValue(promotionResponseFixture);
      render(<CompetitorAnalysis {...defaultProps} result={competitorResultFixture} />);

      await userEvent.click(
        screen.getByRole('checkbox', { name: `Select ${firstPrimaryKeyword.keyword}` })
      );
      await userEvent.click(
        screen.getByRole('checkbox', { name: `Select ${secondPrimaryKeyword.keyword}` })
      );
      await userEvent.selectOptions(screen.getByLabelText('Status'), 'paused');
      await userEvent.selectOptions(screen.getByLabelText('Priority'), 'high');
      await userEvent.click(screen.getByRole('button', { name: 'Promote selected' }));
      await screen.findByText('2 created, 0 skipped');

      expect(mockApiPost).toHaveBeenCalledTimes(1);
      expect(mockApiPost).toHaveBeenCalledWith(
        promotionEndpoint,
        {
          keywords: [firstPrimaryKeyword, secondPrimaryKeyword],
          status: 'paused',
          priority: 'high',
        },
        { signal: expect.any(AbortSignal) }
      );
    });

    it('posts the research context of each selected competitor keyword', async () => {
      mockApiPost.mockResolvedValue(promotionResponseFixture);
      render(<CompetitorAnalysis {...defaultProps} result={competitorResultFixture} />);

      await userEvent.click(
        screen.getByRole('checkbox', { name: `Select ${firstPrimaryKeyword.keyword}` })
      );
      await userEvent.click(
        screen.getByRole('checkbox', { name: `Select ${secondPrimaryKeyword.keyword}` })
      );
      await userEvent.click(screen.getByRole('button', { name: 'Promote selected' }));
      await screen.findByText('2 created, 0 skipped');

      const [postedCall] = mockApiPost.mock.calls as [
        [string, { keywords: ExpandedKeywordWithSource[] }],
      ];

      expect(postedCall[1].keywords.map((kw) => kw.source)).toStrictEqual([
        firstPrimaryKeyword.source,
        secondPrimaryKeyword.source,
      ]);
      expect(postedCall[1].keywords.map((kw) => kw.intent)).toStrictEqual([
        firstPrimaryKeyword.intent,
        secondPrimaryKeyword.intent,
      ]);
      expect(postedCall[1].keywords.map((kw) => kw.competition)).toStrictEqual([
        firstPrimaryKeyword.competition,
        secondPrimaryKeyword.competition,
      ]);
    });
  });
});
