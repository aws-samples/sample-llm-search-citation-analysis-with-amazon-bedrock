import {
  describe, expect, it
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { SeoElementsDisplay } from './CompetitorAnalysisComponents';
import type { SeoElements } from '../../types';

/**
 * The elements `fetch_page_seo_elements` extracts today, all populated. The
 * `title` is what makes the block render at all.
 */
const seoElementsFixture: SeoElements = {
  title: 'Hotel Gran Marino | Official site',
  meta_description: 'Sea-view rooms in the centre of A Coruña.',
  meta_keywords: 'hotel coruña, sea view',
  h1_tags: ['Hotel Gran Marino'],
  h2_tags: ['Rooms', 'Breakfast'],
  h3_tags: ['Sea view', 'Family', 'Suite', 'Standard', 'Superior', 'Attic'],
  og_title: 'Hotel Gran Marino – book direct',
  og_description: 'Best rate guaranteed on the official site.',
  canonical: 'https://hotelgranmarino.example/en/',
};

/**
 * A job stored before the backend extracted the Open Graph tags, the H3s and
 * the canonical link: the type declares those fields, the row has none.
 */
const legacySeoElementsFixture = {
  title: seoElementsFixture.title,
  meta_description: seoElementsFixture.meta_description,
  meta_keywords: '',
  h1_tags: seoElementsFixture.h1_tags,
  h2_tags: [],
};

const seoRowFixtures = [
  {
    label: 'H3 Tags',
    value: 'Sea view | Family | Suite | Standard | Superior',
  },
  {
    label: 'OG Title',
    value: seoElementsFixture.og_title,
  },
  {
    label: 'OG Description',
    value: seoElementsFixture.og_description,
  },
  {
    label: 'Canonical URL',
    value: seoElementsFixture.canonical,
  },
];

describe('SeoElementsDisplay', () => {
  it.each(seoRowFixtures)('renders the $label row with its value when the field is present', ({
    label, value
  }) => {
    render(<SeoElementsDisplay seoElements={seoElementsFixture} />);

    expect(screen.getByText(`${label}:`)).toBeInTheDocument();
    expect(screen.getByText(value)).toBeInTheDocument();
  });

  it.each(seoRowFixtures)('renders no $label row for a job stored before the field existed', ({ label }) => {
    render(<SeoElementsDisplay seoElements={legacySeoElementsFixture} />);

    expect(screen.queryByText(`${label}:`)).not.toBeInTheDocument();
  });

  it('links the canonical URL to the page it names', () => {
    render(<SeoElementsDisplay seoElements={seoElementsFixture} />);

    expect(screen.getByRole('link', { name: seoElementsFixture.canonical })).toHaveAttribute(
      'href',
      seoElementsFixture.canonical
    );
  });

  it('shows at most five H3 tags', () => {
    render(<SeoElementsDisplay seoElements={seoElementsFixture} />);

    expect(screen.queryByText(/Attic/)).not.toBeInTheDocument();
  });

  it('keeps the rows the legacy job does carry', () => {
    render(<SeoElementsDisplay seoElements={legacySeoElementsFixture} />);

    expect(screen.getByText('Title Tag:')).toBeInTheDocument();
    expect(screen.getByText('Meta Description:')).toBeInTheDocument();
    expect(screen.getByText('H1 Tags:')).toBeInTheDocument();
    expect(screen.queryByText('H2 Tags:')).not.toBeInTheDocument();
  });

  it('renders nothing when the page yielded no title, description or headings', () => {
    const { container } = render(
      <SeoElementsDisplay seoElements={{
        ...seoElementsFixture,
        title: '',
        meta_description: '',
        h1_tags: [],
        h2_tags: [],
      }} />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
