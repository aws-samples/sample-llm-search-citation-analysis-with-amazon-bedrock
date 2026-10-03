import {
  describe, expect, it, vi
} from 'vitest';
import {
  fireEvent, render, screen
} from '@testing-library/react';
import { CitationDetailModal } from './CitationDetailModal';
import { buildCrawledContent } from './CitationDetailModal-fixtures';

vi.mock('../../api/dashboard', () => ({ fetchCrawlHistory: vi.fn(() => Promise.resolve([])) }));

describe('CitationDetailModal overview', () => {
  it('shows the load time, content size, citations and provider count', () => {
    render(<CitationDetailModal citation={buildCrawledContent()} onClose={vi.fn()} />);

    expect(['Load Time', 'Content Size', 'Citations', 'Providers'].map((label) => screen.getByText(label).nextElementSibling?.textContent))
      .toStrictEqual(['820ms', '12.3KB', '4', '2']);
  });

  it('shows N/A for a page crawled without load metrics', () => {
    render(<CitationDetailModal citation={buildCrawledContent({
      page_load_time_ms: undefined,
      content_length: undefined,
    })} onClose={vi.fn()} />);

    expect(['Load Time', 'Content Size'].map((label) => screen.getByText(label).nextElementSibling?.textContent)).toStrictEqual(['N/A', 'N/A']);
  });
});

describe('CitationDetailModal SEO analysis', () => {
  it('lists the strengths and weaknesses of the page', () => {
    render(<CitationDetailModal citation={buildCrawledContent({
      seo_analysis: {
        strengths: ['Clear room prices'],
        weaknesses: ['No pool photos', 'Slow gallery'],
      },
    })} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'SEO Analysis' }));

    expect(screen.getByRole('heading', { name: 'Strengths' }).nextElementSibling).toHaveTextContent('•Clear room prices');
    expect(screen.getByRole('heading', { name: 'Weaknesses' }).nextElementSibling).toHaveTextContent('•No pool photos•Slow gallery');
  });

  it('omits a point list the analysis left empty', () => {
    render(<CitationDetailModal citation={buildCrawledContent({
      seo_analysis: {
        strengths: [],
        weaknesses: ['No pool photos'],
      },
    })} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'SEO Analysis' }));

    expect(screen.queryByRole('heading', { name: 'Strengths' })).not.toBeInTheDocument();
  });
});
