import type {
  CitationOwnershipFacts, CitationOwnershipRow, CompetitorCaveatRow, Insight, OwnedPageRow, OwnedPagesFacts, PromptEngineFacts, PromptEngineRow
} from './insights';

/**
 * The Phase 2 facts of the airline group of `./insights-fixtures`: positions
 * per keyword and engine, who the engines cite, which Aurora Airways pages and
 * the caveats on competitors, with the insights they raise. Every figure is
 * distinct, so a figure in the wrong column shows up as a wrong value.
 */

/** The Lima keyword: Gemini never names the brand, OpenAI places it 5th, unless overridden. */
export function buildPromptEngineRow(overrides: Partial<PromptEngineRow> = {}): PromptEngineRow {
  return {
    keyword: 'cheap flights to Lima',
    visibility_score: 12.5,
    positions: {
      gemini: null,
      openai: 5,
    },
    lost_engines: ['gemini', 'openai'],
    ...overrides,
  };
}

/** The Lima keyword, then the Europe keyword (2nd on Gemini, 4th on OpenAI); none left out. */
export function buildPromptEngine(overrides: Partial<PromptEngineFacts> = {}): PromptEngineFacts {
  return {
    engines: ['gemini', 'openai'],
    keywords: [
      buildPromptEngineRow(),
      buildPromptEngineRow({
        keyword: 'Best airline to fly from Europe to South America',
        visibility_score: 61.3,
        positions: {
          gemini: 2,
          openai: 4,
        },
        lost_engines: ['openai'],
      }),
    ],
    omitted: 0,
    ...overrides,
  };
}

/** One engine's citation split, OpenAI's unless overridden: Borealis Air's site cited more than Aurora Airways'. */
export function buildOwnershipRow(overrides: Partial<CitationOwnershipRow> = {}): CitationOwnershipRow {
  return {
    engine: 'openai',
    answers: 10,
    citations: 113,
    owned: 28,
    competitors: { 'Borealis Air': 52 },
    third_party: 33,
    ...overrides,
  };
}

/** Gemini (6 owned, 3 Borealis Air, 5 others of 14) and OpenAI, owned and competitor domains configured. */
export function buildCitationOwnership(overrides: Partial<CitationOwnershipFacts> = {}): CitationOwnershipFacts {
  return {
    owned_configured: true,
    competitors_configured: true,
    engines: [
      buildOwnershipRow({
        engine: 'gemini',
        answers: 8,
        citations: 14,
        owned: 6,
        competitors: { 'Borealis Air': 3 },
        third_party: 5,
      }),
      buildOwnershipRow(),
    ],
    ...overrides,
  };
}

/** The investor report, a PDF OpenAI cites 36 times, unless overridden. */
export function buildOwnedPage(overrides: Partial<OwnedPageRow> = {}): OwnedPageRow {
  return {
    url: 'investors.aurora-airways.com/files/annual-report-2025.pdf',
    section: 'investors.aurora-airways.com/files',
    is_document: true,
    citations: 36,
    engines: ['openai'],
    ...overrides,
  };
}

/** The investor report, then the Lima fares page; OpenAI cites more documents than pages. */
export function buildOwnedPages(overrides: Partial<OwnedPagesFacts> = {}): OwnedPagesFacts {
  return {
    pages: [
      buildOwnedPage(),
      buildOwnedPage({
        url: 'aurora-airways.com/fares/lima',
        section: 'aurora-airways.com/fares',
        is_document: false,
        citations: 32,
        engines: ['gemini', 'openai'],
      }),
    ],
    pages_omitted: 0,
    sections: [
      {
        section: 'investors.aurora-airways.com/files',
        citations: 36,
        document_citations: 36,
        pages: 1,
      },
      {
        section: 'aurora-airways.com/fares',
        citations: 32,
        document_citations: 0,
        pages: 1,
      },
    ],
    engines: [
      {
        engine: 'gemini',
        document_citations: 0,
        page_citations: 6,
      },
      {
        engine: 'openai',
        document_citations: 36,
        page_citations: 26,
      },
    ],
    document_citations: 36,
    page_citations: 32,
    ...overrides,
  };
}

/** The owned pages of a scope no answer cites a page of. */
export function emptyOwnedPages(): OwnedPagesFacts {
  return buildOwnedPages({
    pages: [],
    sections: [],
    engines: [],
    document_citations: 0,
    page_citations: 0,
  });
}

/** Borealis Air, worded mixed or negative in 19 of 31 mentions, unless overridden. */
export function buildCaveatRow(overrides: Partial<CompetitorCaveatRow> = {}): CompetitorCaveatRow {
  return {
    name: 'Borealis Air',
    mentions: 31,
    mixed: 17,
    negative: 2,
    caveat_share: 61.3,
    reasons: ['Extra fees for carry-on bags', 'Frequent delays'],
    ...overrides,
  };
}

/** Borealis Air, then Cirrus Jet (4 mentions, one mixed, no reason stored). */
export function buildCompetitorCaveats(): CompetitorCaveatRow[] {
  return [
    buildCaveatRow(),
    buildCaveatRow({
      name: 'Cirrus Jet',
      mentions: 4,
      mixed: 1,
      negative: 0,
      caveat_share: 25,
      reasons: [],
    }),
  ];
}

/** Borealis Air's site cited 52 times by OpenAI against 28 for Aurora Airways: medium. */
export const COMPETITOR_SITES_INSIGHT: Insight = {
  id: 'competitor_sites:openai',
  kind: 'competitor_sites',
  severity: 'medium',
  subject: 'openai',
  evidence: {
    competitor: 'Borealis Air',
    competitor_citations: 52,
    owned_citations: 28,
    answers: 10,
  },
  block: 'insights_citation_ownership',
};

/** OpenAI citing Aurora Airways documents 36 times against 26 web pages: medium. */
export const DOCUMENTS_CITED_INSIGHT: Insight = {
  id: 'documents_cited:openai',
  kind: 'documents_cited',
  severity: 'medium',
  subject: 'openai',
  evidence: {
    document_citations: 36,
    page_citations: 26,
  },
  block: 'insights_owned_pages',
};

/** Borealis Air worded mixed or negative in 61.3% of 31 mentions: high. */
export const COMPETITOR_CAVEAT_INSIGHT: Insight = {
  id: 'competitor_caveat:Borealis Air',
  kind: 'competitor_caveat',
  severity: 'high',
  subject: 'Borealis Air',
  evidence: {
    mentions: 31,
    mixed: 17,
    negative: 2,
    caveat_share: 61.3,
  },
  block: 'insights_competitor_caveats',
};

/** The Lima keyword, lost on both engines, named by one at 5th: low. */
export const PROMPT_GAP_INSIGHT: Insight = {
  id: 'prompt_gap:cheap flights to Lima',
  kind: 'prompt_gap',
  severity: 'low',
  subject: 'cheap flights to Lima',
  evidence: {
    engines: 2,
    named_engines: 1,
    best_position: 5,
    visibility_score: 12.5,
  },
  block: 'insights_prompt_engine',
};

/** The insights the Phase 2 facts above raise, in fact order. */
export function buildPhase2Insights(): Insight[] {
  return [COMPETITOR_SITES_INSIGHT, DOCUMENTS_CITED_INSIGHT, COMPETITOR_CAVEAT_INSIGHT, PROMPT_GAP_INSIGHT];
}
