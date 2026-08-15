import {
  describe, it, expect, vi, beforeEach
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompetitorAnalysis } from './CompetitorAnalysis';
import {
  SELECTION_LIMIT, promotionSuccessMessage
} from '../../hooks/usePromoteKeywords';
import type { CompetitorAnalysisResult } from '../../types';

vi.mock('../../api/client', () => ({ apiPost: vi.fn() }));

import { apiPost } from '../../api/client';

const mockApiPost = vi.mocked(apiPost);

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

/**
 * `created_keywords` entries: the COMPLETE created items as the backend writes
 * them, a superset of the `Keyword` fields the active keyword list reads.
 */
const createdKeywordItemFixtures = [
  {
    id: 'keyword-1',
    keyword: firstPrimaryKeyword.keyword,
    status: 'active',
    created_at: '2024-01-15T10:30:00Z',
    updated_at: '2024-01-15T10:30:00Z',
    region: 'global',
    language: 'en',
    category: '',
    priority: 'normal',
    notes: 'intent: transactional; competition: high; source: title',
  },
  {
    id: 'keyword-2',
    keyword: secondPrimaryKeyword.keyword,
    status: 'active',
    created_at: '2024-01-15T10:30:00Z',
    updated_at: '2024-01-15T10:30:00Z',
    region: 'global',
    language: 'en',
    category: '',
    priority: 'normal',
    notes: 'intent: commercial; competition: medium; source: h1',
  },
];

const promotionResponseFixture = {
  created: 2,
  skipped: 0,
  created_keywords: createdKeywordItemFixtures,
  skipped_keywords: [],
};

/** The success line shown for `promotionResponseFixture`. */
const promotionSuccessText = promotionSuccessMessage({
  created: promotionResponseFixture.created,
  skipped: promotionResponseFixture.skipped,
  createdKeywords: [],
  createdItems: [],
  skippedKeywords: [],
});

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
          keywords.map((keyword) => screen.getByRole(
            'checkbox',
            { name: `Select ${keyword.keyword}` }
          ))
        ).toHaveLength(keywords.length);
        expect(screen.queryAllByRole('columnheader', { name: 'Opportunity' })).toHaveLength(
          expectedOpportunityHeaders
        );
      }
    );

    it('clears the selection when the active section changes', async () => {
      render(<CompetitorAnalysis {...defaultProps} result={competitorResultFixture} />);
      await userEvent.click(
        screen.getByRole('checkbox', { name: `Select ${firstPrimaryKeyword.keyword}` })
      );

      await userEvent.click(screen.getByRole('button', { name: /Secondary Keywords/ }));

      expect(screen.getByText(`0 of ${SELECTION_LIMIT} keywords selected`)).toBeInTheDocument();
      expect(screen.queryAllByRole('checkbox', { checked: true })).toHaveLength(0);
      expect(screen.getByRole('button', { name: 'Add to Keywords' })).toBeDisabled();
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

    it('sends a single promotion request that omits status and priority', async () => {
      mockApiPost.mockResolvedValue(promotionResponseFixture);
      render(<CompetitorAnalysis {...defaultProps} result={competitorResultFixture} />);

      await userEvent.click(
        screen.getByRole('checkbox', { name: `Select ${firstPrimaryKeyword.keyword}` })
      );
      await userEvent.click(
        screen.getByRole('checkbox', { name: `Select ${secondPrimaryKeyword.keyword}` })
      );
      await userEvent.click(screen.getByRole('button', { name: 'Add to Keywords' }));
      await screen.findByText(promotionSuccessText);

      expect(mockApiPost).toHaveBeenCalledTimes(1);
      expect(mockApiPost).toHaveBeenCalledWith(
        promotionEndpoint,
        { keywords: [firstPrimaryKeyword, secondPrimaryKeyword] },
        {
          signal: expect.any(AbortSignal),
          allowStructured4xx: true,
        }
      );
    });
  });
});
