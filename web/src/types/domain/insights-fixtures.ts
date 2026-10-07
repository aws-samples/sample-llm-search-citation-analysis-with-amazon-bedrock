import type { BrandKpis } from './groupKpiHistory';
import type {
  EnginePlay, EnginePlayRow, Insight, KeywordStabilityRow, PortfolioBrandRow, ReportInsightsResponse
} from './insights';
import { buildKpis } from '../../components/Reports/BrandVisibilityReport/groupKpiHistory-fixtures';
import {
  buildCaveatRow, buildCitationOwnership, buildCompetitorCaveats, buildOwnedPage, buildOwnedPages, buildOwnershipRow, emptyOwnedPages, buildPromptEngine,
  buildPromptEngineRow
} from './insightFacts-fixtures';

/**
 * Payloads of `GET /reports/insights` for the specs: the airline group of the
 * endpoint contract. OpenAI ranks the brand first too rarely, Gemini cites it
 * too rarely; Aurora Miles trails Aurora Airways on position and sentiment; the
 * Lima keyword swings between runs. Every figure is distinct, so a figure in
 * the wrong column shows up as a wrong value.
 */

/** One engine's row: `play` over `buildKpis(overrides)`. */
export function buildEnginePlayRow(engine: string, play: EnginePlay, overrides: Partial<BrandKpis> = {}): EnginePlayRow {
  return {
    engine,
    play,
    kpis: buildKpis(overrides),
  };
}

/** OpenAI (ranked first in 40% of 10 answers, cited in 80%) and Gemini (first in 60% of 8, cited in 20%). */
export function buildEngineRows(): EnginePlayRow[] {
  return [
    buildEnginePlayRow('openai', 'get_ranked_first', {
      answers: 10,
      top_1_share: 40,
      top_3_share: 70,
      citation_rate: 80,
      net_sentiment: 25,
    }),
    buildEnginePlayRow('gemini', 'get_cited', {
      answers: 8,
      top_1_share: 60,
      top_3_share: 85,
      citation_rate: 20,
      net_sentiment: -12.5,
    }),
  ];
}

/** Aurora Miles, 2.7 places and 36.3 points behind the leading brand, unless overridden. */
export function buildPortfolioBrand(overrides: Partial<PortfolioBrandRow> = {}): PortfolioBrandRow {
  return {
    name: 'Aurora Miles',
    mentions: 9,
    average_position: 4.78,
    net_sentiment: 55.6,
    citations: null,
    position_gap: 2.7,
    sentiment_gap: 36.3,
    weak: true,
    ...overrides,
  };
}

/** Aurora Airways, the best-placed and best-worded brand, then Aurora Miles trailing it. */
export function buildPortfolio(): PortfolioBrandRow[] {
  return [
    buildPortfolioBrand({
      name: 'Aurora Airways',
      mentions: 20,
      average_position: 2.08,
      net_sentiment: 91.9,
      citations: 7,
      position_gap: 0,
      sentiment_gap: 0,
      weak: false,
    }),
    buildPortfolioBrand(),
  ];
}

/** The Europe keyword, placed 3.67 to 4.33 over two runs without a flip, unless overridden. */
export function buildStabilityRow(overrides: Partial<KeywordStabilityRow> = {}): KeywordStabilityRow {
  return {
    keyword: 'Best airline to fly from Europe to South America',
    runs: 2,
    position_min: 3.67,
    position_max: 4.33,
    position_range: 0.66,
    flips: 0,
    unstable: false,
    ...overrides,
  };
}

/** The steady Europe keyword and the Lima keyword, which swung 3.5 places and flipped once over three runs. */
export function buildStability(): KeywordStabilityRow[] {
  return [
    buildStabilityRow(),
    buildStabilityRow({
      keyword: 'cheap flights to Lima',
      runs: 3,
      position_min: 1.5,
      position_max: 5,
      position_range: 3.5,
      flips: 1,
      unstable: true,
    }),
  ];
}

/** The OpenAI engine-play insight (high: ten answers), unless overridden. */
export function buildInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    id: 'engine_play:openai',
    kind: 'engine_play',
    severity: 'high',
    subject: 'openai',
    evidence: {
      top_1_share: 40,
      citation_rate: 80,
      answers: 10,
      play: 'get_ranked_first',
    },
    block: 'insights_engine_playbook',
    ...overrides,
  };
}

/** The Gemini engine-play insight: eight answers, so medium. */
export const GEMINI_INSIGHT: Insight = buildInsight({
  id: 'engine_play:gemini',
  severity: 'medium',
  subject: 'gemini',
  evidence: {
    top_1_share: 60,
    citation_rate: 20,
    answers: 8,
    play: 'get_cited',
  },
});

/** Aurora Miles trailing on both position and sentiment: high. */
export const WEAK_SUBBRAND_INSIGHT: Insight = buildInsight({
  id: 'weak_subbrand:Aurora Miles',
  kind: 'weak_subbrand',
  severity: 'high',
  subject: 'Aurora Miles',
  evidence: {
    mentions: 9,
    average_position: 4.78,
    net_sentiment: 55.6,
    position_gap: 2.7,
    sentiment_gap: 36.3,
  },
  block: 'insights_brand_portfolio',
});

/** The Lima keyword flipping once: medium. */
export const UNSTABLE_KEYWORD_INSIGHT: Insight = buildInsight({
  id: 'unstable_keyword:cheap flights to Lima',
  kind: 'unstable_keyword',
  severity: 'medium',
  subject: 'cheap flights to Lima',
  evidence: {
    runs: 3,
    position_min: 1.5,
    position_max: 5,
    position_range: 3.5,
    flips: 1,
  },
  block: 'insights_run_stability',
});

/** Every insight of the airline group, in the API order: severity, then answers or mentions. */
export function buildInsights(): Insight[] {
  return [buildInsight(), WEAK_SUBBRAND_INSIGHT, GEMINI_INSIGHT, UNSTABLE_KEYWORD_INSIGHT];
}

/** `GET /reports/insights` for the airline group over its latest runs, unless overridden. */
export function buildReportInsights(overrides: Partial<ReportInsightsResponse> = {}): ReportInsightsResponse {
  return {
    scope: {
      kind: 'group',
      label: '1 group(s)',
      keyword_count: 10,
    },
    keywords_truncated: false,
    timestamp: '2026-10-07T06:50:33.235274Z',
    keywords_analyzed: 10,
    keywords_with_data: 10,
    citations_configured: true,
    facts: {
      engines: buildEngineRows(),
      prompt_engine: buildPromptEngine(),
      citation_ownership: buildCitationOwnership(),
      owned_pages: buildOwnedPages(),
      competitor_caveats: buildCompetitorCaveats(),
      portfolio: buildPortfolio(),
      stability: buildStability(),
    },
    insights: buildInsights(),
    narrative: null,
    ...overrides,
  };
}

/** The payload of a scope with nothing to say: no engine, no citation, no competitor, one qualifying brand at most, no group history. */
export function emptyReportInsights(): ReportInsightsResponse {
  return buildReportInsights({
    facts: {
      engines: [],
      prompt_engine: buildPromptEngine({
        keywords: [],
        engines: [] 
      }),
      citation_ownership: buildCitationOwnership({ engines: [] }),
      owned_pages: emptyOwnedPages(),
      competitor_caveats: [],
      portfolio: [],
      stability: [],
    },
    insights: [],
  });
}

const VALID = buildReportInsights();

/** `VALID` with one of its fact lists replaced by `[row]`. */
function withFact(list: 'engines' | 'competitor_caveats' | 'portfolio' | 'stability', row: unknown): unknown {
  return {
    ...VALID,
    facts: {
      ...VALID.facts,
      [list]: [row],
    },
  };
}

/** `VALID` with one of its fact objects replaced by `VALID`'s own with `fields` overridden. */
function withFactFields(fact: 'prompt_engine' | 'citation_ownership' | 'owned_pages', fields: Record<string, unknown>): unknown {
  return {
    ...VALID,
    facts: {
      ...VALID.facts,
      [fact]: {
        ...VALID.facts[fact],
        ...fields,
      },
    },
  };
}

/** `VALID` with one field of its first insight replaced. */
function withInsightField(field: string, value: unknown): unknown {
  return {
    ...VALID,
    insights: [{
      ...buildInsight(),
      [field]: value,
    }],
  };
}

/** Bodies the guard must reject, each wrong in one place. */
export const REJECTED_REPORT_INSIGHTS_BODIES: ReadonlyArray<[description: string, body: unknown]> = [
  ['a body without its facts', {
    ...VALID,
    facts: undefined,
  }],
  ['nothing', null],
  ['a list of insights', VALID.insights],
  ['a body whose scope is missing', {
    ...VALID,
    scope: undefined,
  }],
  ['a timestamp that is not a string', {
    ...VALID,
    timestamp: 5,
  }],
  ['facts without the engines list', {
    ...VALID,
    facts: {
      ...VALID.facts,
      engines: undefined,
    },
  }],
  ['an engine with an unknown play', withFact('engines', {
    ...buildEnginePlayRow('openai', 'defend'),
    play: 'attack',
  })],
  ['an engine without KPIs', withFact('engines', {
    ...buildEnginePlayRow('openai', 'defend'),
    kpis: null,
  })],
  ['a brand whose position gap is a string', withFact('portfolio', {
    ...buildPortfolioBrand(),
    position_gap: '2.7',
  })],
  ['a brand without the weak flag', withFact('portfolio', {
    ...buildPortfolioBrand(),
    weak: undefined,
  })],
  ['a keyword whose flips are missing', withFact('stability', {
    ...buildStabilityRow(),
    flips: undefined,
  })],
  ['a keyword whose position range is null', withFact('stability', {
    ...buildStabilityRow(),
    position_range: null,
  })],
  ['facts without the prompt-by-engine positions', withFactFields('prompt_engine', { keywords: undefined })],
  ['a keyword whose position is a string', withFactFields('prompt_engine', {
    keywords: [{
      ...buildPromptEngineRow(),
      positions: { openai: '5' } 
    }] 
  })],
  ['a keyword whose lost engines are not strings', withFactFields('prompt_engine', {
    keywords: [{
      ...buildPromptEngineRow(),
      lost_engines: [5] 
    }] 
  })],
  ['citation ownership without its competitor flag', withFactFields('citation_ownership', { competitors_configured: undefined })],
  ['an engine whose competitor count is a string', withFactFields('citation_ownership', {
    engines: [{
      ...buildOwnershipRow(),
      competitors: { 'Borealis Air': '52' } 
    }],
  })],
  ['owned pages without the document total', withFactFields('owned_pages', { document_citations: undefined })],
  ['an owned page without its document flag', withFactFields('owned_pages', {
    pages: [{
      ...buildOwnedPage(),
      is_document: 'yes' 
    }] 
  })],
  ['an owned section without its page count', withFactFields('owned_pages', {
    sections: [{
      section: 'aurora-airways.com/fares',
      citations: 1,
      document_citations: 0 
    }] 
  })],
  ['an owned-pages engine without its page citations', withFactFields('owned_pages', {
    engines: [{
      engine: 'openai',
      document_citations: 1 
    }] 
  })],
  ['a competitor whose reasons are not strings', withFact('competitor_caveats', {
    ...buildCaveatRow(),
    reasons: [1] 
  })],
  ['a competitor whose caveat share is a string', withFact('competitor_caveats', {
    ...buildCaveatRow(),
    caveat_share: '61.3' 
  })],
  ['insights that are not a list', {
    ...VALID,
    insights: {},
  }],
  ['an insight of an unknown kind', withInsightField('kind', 'hunch')],
  ['an insight of an unknown severity', withInsightField('severity', 'urgent')],
  ['an insight pointing at an unknown block', withInsightField('block', 'insights_summary')],
  ['an insight without a subject', withInsightField('subject', null)],
  ['an insight whose evidence is a list', withInsightField('evidence', [40, 80])],
  ['an insight whose evidence nests an object', withInsightField('evidence', { kpis: { answers: 10 } })],
  ['a narrative that is a string', {
    ...VALID,
    narrative: 'Nothing to report.',
  }],
  ['a narrative that is a list', {
    ...VALID,
    narrative: [],
  }],
];
