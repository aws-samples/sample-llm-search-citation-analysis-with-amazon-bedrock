/**
 * Display rules of rank tracking: position cells, sorting, schedule labels and SERP feature labels.
 *
 * Position cell: not checked = "–"; a miss = "Not found", or "Not found (unconfirmed)" when the keyword ranked
 * before and the re-checks did not find it; a previous position that is now missing reads "prev → lost";
 * otherwise "prev → pos", green when it rose, amber when it fell. Sorting puts keywords without a position last.
 */
import type { CompetitorDomain } from '../../../api/brandSettings';
import type {
  RankCell, RankDevice, RankResultRow, RankSchedule, RankTracker
} from '../../../types/api/seoRankTracking';
import { NO_MARKET_LABEL } from '../../Markets/marketSelection';

export type PositionTone = 'up' | 'down' | 'same' | 'lost' | 'muted';

export interface PositionDisplay {
  readonly text: string;
  readonly tone: PositionTone;
}

export const NOT_FOUND_UNCONFIRMED = 'Not found (unconfirmed)';

function missText(cell: RankCell): PositionDisplay {
  if (cell.status === 'not_found_unconfirmed') return {
    text: NOT_FOUND_UNCONFIRMED,
    tone: 'muted' 
  };
  if (cell.previous_position !== null) return {
    text: `${cell.previous_position} → lost`,
    tone: 'lost' 
  };
  return {
    text: 'Not found',
    tone: 'muted' 
  };
}

function movement(previous: number, position: number): PositionTone {
  if (position < previous) return 'up';
  return position > previous ? 'down' : 'same';
}

export function positionDisplay(cell: RankCell | null): PositionDisplay {
  if (cell === null || cell.status === 'not_checked') return {
    text: '–',
    tone: 'muted' 
  };
  if (cell.position === null) return missText(cell);
  const previous = cell.previous_position;
  if (previous === null) return {
    text: String(cell.position),
    tone: 'same' 
  };
  return {
    text: `${previous} → ${cell.position}`,
    tone: movement(previous, cell.position),
  };
}

/** Rows by the position on `device`, best first, keywords without a position last (then by keyword). */
export function sortByPosition(rows: readonly RankResultRow[], device: RankDevice): RankResultRow[] {
  const rank = (row: RankResultRow): number => row[device]?.position ?? Number.POSITIVE_INFINITY;
  return [...rows].sort((left, right) => (rank(left) - rank(right)) || left.keyword.localeCompare(right.keyword));
}

export const SCHEDULE_LABELS: Readonly<Record<RankSchedule, string>> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly (last day)',
  manual: 'Manual only',
};

/** The domain select's value of its free-text "Other domain" option. */
export const OTHER_DOMAIN = '__other__';

export interface DomainOption {
  readonly value: string;
  readonly label: string;
}

/** The domains a tracker can be created for: the brand's own (as they are), then each competitor's. */
export function rankDomainOptions(owned: readonly string[], competitors: readonly CompetitorDomain[]): DomainOption[] {
  return [
    ...owned.map((domain) => ({
      value: domain,
      label: domain,
    })),
    ...competitors.map((competitor) => ({
      value: competitor.domain,
      label: `Competitor: ${competitor.name} (${competitor.domain})`,
    })),
  ];
}

/** "in Chile (Spanish)", or "without a market" for the keywords without one (`NO_MARKET_LABEL`). */
export function inMarketText(marketLabel: string): string {
  return marketLabel === NO_MARKET_LABEL ? 'without a market' : `in ${marketLabel}`;
}

/** What a tracker's keywords are, for its card. */
export function keywordScopeLabel(tracker: Pick<RankTracker, 'keyword_scope'>): string {
  if (tracker.keyword_scope === 'all') return 'all keywords of the market';
  return tracker.keyword_scope === 'group' ? 'one keyword group' : 'extra keywords only';
}

/** The note shown when a scope holds more keywords than a check covers; `null` when it does not. */
export function keywordCapNote(counts: {
  readonly keyword_count: number;
  readonly scope_keyword_count: number 
}): string | null {
  if (counts.scope_keyword_count <= counts.keyword_count) return null;
  return `These keywords number ${counts.scope_keyword_count.toLocaleString('en-US')}; each check covers the first ${counts.keyword_count.toLocaleString('en-US')}.`;
}

export const SERP_FEATURE_LABELS: Readonly<Record<string, string>> = {
  featured_snippet: 'FS',
  people_also_ask: 'PAA',
  ai_overview: 'AI',
  local_pack: 'Local',
  knowledge_graph: 'KP',
  video: 'Video',
  images: 'Img',
  shopping: 'Shop',
  top_stories: 'News',
};

/** The short labels of the SERP features worth flagging (organic results are not a feature). */
export function featureLabels(features: readonly string[]): string[] {
  return features.flatMap((feature) => (feature in SERP_FEATURE_LABELS ? [SERP_FEATURE_LABELS[feature]] : []));
}
