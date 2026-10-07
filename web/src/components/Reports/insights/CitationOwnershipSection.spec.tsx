import {
  describe, expect, it
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import {
  buildCitationOwnership, buildOwnershipRow
} from '../../../types/domain/insightFacts-fixtures';
import {
  ADD_COMPETITOR_DOMAINS, ADD_OWNED_DOMAINS, CITATION_OWNERSHIP_TITLE, CitationOwnershipSection, OWNERSHIP_EMPTY
} from './CitationOwnershipSection';
import {
  columnTooltip, describeInsightsSectionPlaceholders, expectEmptySection, insightLines, insightsWithFacts, loadedInsights, sectionColumnHeadings,
  sectionRows
} from './insightSections-fixtures';

function renderOwnership(slice = loadedInsights()) {
  return render(<CitationOwnershipSection {...slice} />);
}

const UNSPLIT = buildCitationOwnership({
  competitors_configured: false,
  engines: [buildOwnershipRow({
    competitors: {},
    third_party: 85,
  })],
});

describe('CitationOwnershipSection', () => {
  it('heads the engine, your domains, each competitor with domains, third parties and the total', () => {
    renderOwnership();

    expect(sectionColumnHeadings(CITATION_OWNERSHIP_TITLE)).toStrictEqual(['AI engine', 'Your domains', 'Borealis Air', 'Third parties', 'All citations']);
  });

  it('lists each engine with its citations of your site, the competitor, third parties and in all', () => {
    renderOwnership();

    expect(sectionRows(CITATION_OWNERSHIP_TITLE)).toStrictEqual([
      ['Google Gemini', '6', '3', '5', '14'],
      ['OpenAI', '28', '52', '33', '113'],
    ]);
  });

  it('explains a competitor column by the domains it counts', () => {
    renderOwnership();

    expect(columnTooltip('Borealis Air')).toHaveAccessibleDescription('Citations of Borealis Air\'s domains.');
  });

  it('reads out the competitor-sites insight above the table, and no other insight', () => {
    renderOwnership();

    expect(insightLines(CITATION_OWNERSHIP_TITLE)).toStrictEqual(['OpenAI: cites Borealis Air\'s site 52 times, yours 28 times.']);
  });

  it('counts everyone else in one column and says how to add competitor domains when none is configured', () => {
    renderOwnership(insightsWithFacts({ citation_ownership: UNSPLIT }));

    expect(sectionColumnHeadings(CITATION_OWNERSHIP_TITLE)).toStrictEqual(['AI engine', 'Your domains', 'Everyone else', 'All citations']);
    expect(screen.getByText(ADD_COMPETITOR_DOMAINS)).toBeInTheDocument();
  });

  it('says how to add your own domains when none is configured', () => {
    renderOwnership(insightsWithFacts({ citation_ownership: buildCitationOwnership({ owned_configured: false }) }));

    expect(screen.getByText(ADD_OWNED_DOMAINS)).toBeInTheDocument();
  });

  it('adds no setup advice once both are configured', () => {
    renderOwnership();

    expect(screen.queryByText(/Settings › Brand tracking/u)).not.toBeInTheDocument();
  });

  it('says no engine answered, without a table, when there is none', () => {
    renderOwnership(insightsWithFacts({ citation_ownership: buildCitationOwnership({ engines: [] }) }));

    expectEmptySection(CITATION_OWNERSHIP_TITLE, OWNERSHIP_EMPTY);
  });

  describeInsightsSectionPlaceholders(CitationOwnershipSection);
});
