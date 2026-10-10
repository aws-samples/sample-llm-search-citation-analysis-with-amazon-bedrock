import {
  describe, expect, it, vi
} from 'vitest';
import {
  fireEvent, render, screen
} from '@testing-library/react';
import { CitationDetailModal } from './CitationDetailModal';
import {
  buildCrawledContent, buildVideoCrawl
} from './CitationDetailModal-fixtures';
import type {
  CrawledContent, SEOAnalysis
} from '../../types';

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

/** Renders the modal for a page with `seoAnalysis` and opens its SEO Analysis tab. */
function renderSeoTab(seoAnalysis: SEOAnalysis) {
  render(<CitationDetailModal citation={buildCrawledContent({ seo_analysis: seoAnalysis })} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('tab', { name: 'SEO Analysis' }));
}

describe('CitationDetailModal SEO analysis', () => {
  it('lists the strengths and weaknesses of the page', () => {
    renderSeoTab({
      strengths: ['Clear room prices'],
      weaknesses: ['No pool photos', 'Slow gallery'],
    });

    expect(screen.getByRole('heading', { name: 'Strengths' }).nextElementSibling).toHaveTextContent('•Clear room prices');
    expect(screen.getByRole('heading', { name: 'Weaknesses' }).nextElementSibling).toHaveTextContent('•No pool photos•Slow gallery');
  });

  it('omits a point list the analysis left empty', () => {
    renderSeoTab({
      strengths: [],
      weaknesses: ['No pool photos'],
    });

    expect(screen.queryByRole('heading', { name: 'Strengths' })).not.toBeInTheDocument();
  });
});

/** Renders the modal for `citation`. */
function renderModalFor(citation: CrawledContent) {
  render(<CitationDetailModal citation={citation} onClose={vi.fn()} />);
}

/** The "YouTube video" heading of the video section, `null` when the section is not shown. */
function queryVideoHeadingElement() {
  return screen.queryByRole('heading', { name: 'YouTube video' });
}

describe('CitationDetailModal YouTube video', () => {
  it('shows the video thumbnail with alt text naming the video', () => {
    renderModalFor(buildVideoCrawl());

    expect(screen.getByRole('img', { name: 'Thumbnail of the YouTube video Hotel Sol room tour' }))
      .toHaveAttribute('src', 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  });

  it('links the channel name to the channel', () => {
    renderModalFor(buildVideoCrawl());

    expect(screen.getByRole('link', { name: 'Hotel Sol' })).toHaveAttribute('href', 'https://www.youtube.com/@hotelsol');
  });

  it('hides a thumbnail that is not an https link', () => {
    renderModalFor(buildVideoCrawl({ thumbnail_url: 'data:image/png;base64,AAAA' }));

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows the channel name as plain text when its link is not http(s)', () => {
    renderModalFor(buildVideoCrawl({ author_url: 'javascript:alert(1)' }));

    expect(screen.queryByRole('link', { name: 'Hotel Sol' })).not.toBeInTheDocument();
    expect(screen.getByText('Hotel Sol')).toBeInTheDocument();
  });

  it('shows no video section for a video without thumbnail or channel', () => {
    renderModalFor(buildVideoCrawl({
      thumbnail_url: '',
      author_name: '',
    }));

    expect(queryVideoHeadingElement()).not.toBeInTheDocument();
  });

  it('shows no video section for an ordinary page', () => {
    renderModalFor(buildCrawledContent({ thumbnail_url: 'https://example.com/a.jpg' }));

    expect(queryVideoHeadingElement()).not.toBeInTheDocument();
  });

  it('shows the video section when only the oEmbed provider marks the crawl', () => {
    renderModalFor(buildVideoCrawl({ content_type: undefined }));

    expect(queryVideoHeadingElement()).toBeInTheDocument();
  });
});
