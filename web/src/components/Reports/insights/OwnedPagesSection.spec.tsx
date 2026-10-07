import {
  describe, expect, it
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import {
  buildOwnedPages, emptyOwnedPages
} from '../../../types/domain/insightFacts-fixtures';
import { buildReportInsights } from '../../../types/domain/insights-fixtures';
import {
  OWNED_PAGES_EMPTY, OWNED_PAGES_TITLE, OWNED_PAGES_UNCONFIGURED, OwnedPagesSection
} from './OwnedPagesSection';
import {
  columnTooltip, describeInsightsSectionPlaceholders, expectEmptySection, insightLines, insightsWithFacts, loadedInsights, sectionColumnHeadings,
  sectionRows
} from './insightSections-fixtures';

function renderPages(slice = loadedInsights()) {
  return render(<OwnedPagesSection {...slice} />);
}

const NO_PAGES = emptyOwnedPages();

describe('OwnedPagesSection', () => {
  it('heads the page, its section, its citations and the engines citing it', () => {
    renderPages();

    expect(sectionColumnHeadings(OWNED_PAGES_TITLE)).toStrictEqual(['Page', 'Section', 'Citations', 'AI engines']);
  });

  it('explains the section as the site and first path segment', () => {
    renderPages();

    expect(columnTooltip('Section')).toHaveAccessibleDescription('The site and first path segment the page sits under.');
  });

  it('lists the most-cited pages first, marking the documents', () => {
    renderPages();

    expect(sectionRows(OWNED_PAGES_TITLE)).toStrictEqual([
      ['investors.aurora-airways.com/files/annual-report-2025.pdfDocument', 'investors.aurora-airways.com/files', '36', 'OpenAI'],
      ['aurora-airways.com/fares/lima', 'aurora-airways.com/fares', '32', 'Google Gemini, OpenAI'],
    ]);
  });

  it('reads out the documents-cited insight above the table, and no other insight', () => {
    renderPages();

    expect(insightLines(OWNED_PAGES_TITLE)).toStrictEqual(['OpenAI: cites your documents 36 times, your web pages 26 times.']);
  });

  it('states the document and web-page citations under the table', () => {
    renderPages();

    expect(screen.getByText('Documents (PDFs and other downloads): 36 citations; web pages: 32.')).toBeInTheDocument();
  });

  it.each([
    [1, '1 less-cited page is not shown.'],
    [4, '4 less-cited pages are not shown.'],
  ])('says %i pages were left out beyond the cap', (omitted, note) => {
    renderPages(insightsWithFacts({ owned_pages: buildOwnedPages({ pages_omitted: omitted }) }));

    expect(screen.getByText(new RegExp(`${note}$`, 'u'))).toBeInTheDocument();
  });

  it('says no page is cited yet, without a table or a split, when owned domains are configured', () => {
    renderPages(insightsWithFacts({ owned_pages: NO_PAGES }));

    expectEmptySection(OWNED_PAGES_TITLE, OWNED_PAGES_EMPTY);
    expect(screen.queryByText(/^Documents/u)).not.toBeInTheDocument();
  });

  it('says how to add your own domains while none is configured', () => {
    renderPages(loadedInsights({
      citations_configured: false,
      facts: {
        ...buildReportInsights().facts,
        owned_pages: NO_PAGES,
      },
    }));

    expectEmptySection(OWNED_PAGES_TITLE, OWNED_PAGES_UNCONFIGURED);
  });

  describeInsightsSectionPlaceholders(OwnedPagesSection);
});
