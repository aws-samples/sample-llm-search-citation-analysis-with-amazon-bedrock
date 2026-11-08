/**
 * The SEO vs GEO definitions (rules in `lambda/shared/seo_geo.py`),
 * the one text every tooltip, table heading and the report's definitions
 * block use; `docs/seo-metrics.md` is written from it. These are not answer
 * KPIs: they live apart from `kpiDefinitions.ts` and its contract.
 */
import type { KpiDefinition } from './kpiDefinitions';
import type { SeoGeoQuadrant } from '../types/api/seo';

/** Organic positions up to this one are "SEO strong" (Google's first page); `seo_geo.SEO_TOP_POSITION`. */
export const SEO_TOP_POSITION = 10;

/** AI mention rates (percent) from this one up are "GEO strong"; `seo_geo.GEO_MENTION_RATE`. */
export const GEO_MENTION_RATE = 50;

export type SeoGeoMetricId =
  | 'search_volume'
  | 'organic_position'
  | 'ranked_position'
  | 'estimated_traffic'
  | 'competitor_positions'
  | 'ai_overview_shown'
  | 'ai_overview_cites_you'
  | 'ai_mention_rate'
  | 'answers'
  | 'citation_overlap'
  | 'quadrant'
  | 'traffic_share'
  | 'share_of_voice';

const RUN_NOTE = 'Per keyword and market, from its latest analysis run with a Google AI Overviews result.';

export const SEO_GEO_METRICS: Readonly<Record<SeoGeoMetricId, KpiDefinition>> = {
  search_volume: {
    label: 'Volume',
    definition: 'Average monthly Google searches for the keyword in the market (DataForSEO keyword metrics); blank until its metrics are fetched.',
  },
  organic_position: {
    label: 'Organic position',
    definition: `Your best position in the organic top ${SEO_TOP_POSITION} of the Google results page the AI Overviews engine read (a domain of yours or one of its subdomains); ">${SEO_TOP_POSITION}" when none of your domains is in it. ${RUN_NOTE}`,
  },
  ranked_position: {
    label: 'Ranked position',
    definition: `Your best organic position from a deeper source when the results page has none of your domains in its top ${SEO_TOP_POSITION}: a rank-tracked position, else your latest estimated traffic snapshot (DataForSEO ranked keywords, positions 1-100). Blank when neither ranks you.`,
  },
  estimated_traffic: {
    label: 'Estimated traffic',
    definition: 'Estimated monthly organic visits your domains get from the keyword, from their latest weekly snapshot in the market: DataForSEO\'s estimate from search volume and position, not measured clicks. Blank without a snapshot.',
  },
  competitor_positions: {
    label: 'Competitor organic position',
    definition: `The same best position for each competitor with domains set in Brand Tracking; ">${SEO_TOP_POSITION}" when none of its domains is in the top ${SEO_TOP_POSITION}.`,
  },
  ai_overview_shown: {
    label: 'AI Overview shown',
    definition: `Whether Google showed an AI Overview for the keyword: "Yes" for a results page with one, "No" for a page without (counted as no answer, outside every KPI). ${RUN_NOTE}`,
  },
  ai_overview_cites_you: {
    label: 'AI Overview cites you',
    definition: 'Whether one of your domains is among the references of the AI Overview ("No" when no overview was shown); blank when Brand Tracking lists no domain of yours.',
  },
  ai_mention_rate: {
    label: 'AI mention rate',
    definition: 'The mention rate KPI for the keyword in that run: the share of successful answers, every AI engine including Google AI Overviews, that name your brand.',
  },
  answers: {
    label: 'Answers',
    definition: 'The successful AI answers for the keyword in that run that the AI mention rate counts.',
  },
  citation_overlap: {
    label: 'Citation overlap',
    definition: `The percentage of distinct URLs cited by the run's AI answers (the AI Overview's references included) that are also in its organic top ${SEO_TOP_POSITION}; blank when the answers cite nothing.`,
  },
  quadrant: {
    label: 'Quadrant',
    definition: `SEO strong = organic position ${SEO_TOP_POSITION} or better; GEO strong = AI mention rate ${GEO_MENTION_RATE}% or more. A keyword without a Google AI Overviews result or without answers has no data.`,
  },
  traffic_share: {
    label: 'Share of estimated search traffic',
    definition: 'Your (or a competitor\'s) estimated monthly organic visits over the keywords in scope, as a share of the total of you and every competitor with domains set in Brand Tracking. From each domain\'s latest weekly snapshot (DataForSEO estimates, not measured clicks); blank for a brand without a snapshot.',
  },
  share_of_voice: {
    label: 'Share of AI mentions',
    definition: 'The share of voice KPI over the same keywords\' latest runs: the brand\'s share of every brand mention in the successful AI answers.',
  },
};

export interface QuadrantDefinition extends KpiDefinition {readonly id: SeoGeoQuadrant;}

/** The quadrants in the order the report shows them. */
export const SEO_GEO_QUADRANTS: readonly QuadrantDefinition[] = [
  {
    id: 'both_strong',
    label: 'Both strong',
    definition: `In Google's top ${SEO_TOP_POSITION} and named in at least ${GEO_MENTION_RATE}% of AI answers.`,
  },
  {
    id: 'ai_gap',
    label: 'AI gap',
    definition: `In Google's top ${SEO_TOP_POSITION} but named in fewer than ${GEO_MENTION_RATE}% of AI answers: the AI engines do not reflect your search standing.`,
  },
  {
    id: 'seo_gap',
    label: 'SEO gap',
    definition: `Named in at least ${GEO_MENTION_RATE}% of AI answers but not in Google's top ${SEO_TOP_POSITION}.`,
  },
  {
    id: 'both_weak',
    label: 'Both weak',
    definition: `Not in Google's top ${SEO_TOP_POSITION} and named in fewer than ${GEO_MENTION_RATE}% of AI answers.`,
  },
  {
    id: 'no_data',
    label: 'No data',
    definition: 'No analysis run with a Google AI Overviews result yet, or no successful AI answer in it.',
  },
];

const QUADRANTS_BY_ID: ReadonlyMap<SeoGeoQuadrant, QuadrantDefinition> = new Map(SEO_GEO_QUADRANTS.map((quadrant) => [quadrant.id, quadrant]));

export function quadrantDefinition(id: SeoGeoQuadrant): QuadrantDefinition | undefined {
  return QUADRANTS_BY_ID.get(id);
}

/** Every definition the SEO vs GEO report shows, for its definitions block. */
export const SEO_GEO_DEFINITIONS: readonly KpiDefinition[] = [
  SEO_GEO_METRICS.search_volume,
  SEO_GEO_METRICS.organic_position,
  SEO_GEO_METRICS.ranked_position,
  SEO_GEO_METRICS.estimated_traffic,
  SEO_GEO_METRICS.competitor_positions,
  SEO_GEO_METRICS.ai_overview_shown,
  SEO_GEO_METRICS.ai_overview_cites_you,
  SEO_GEO_METRICS.ai_mention_rate,
  SEO_GEO_METRICS.answers,
  SEO_GEO_METRICS.citation_overlap,
  SEO_GEO_METRICS.quadrant,
  SEO_GEO_METRICS.traffic_share,
  SEO_GEO_METRICS.share_of_voice,
  ...SEO_GEO_QUADRANTS,
];
