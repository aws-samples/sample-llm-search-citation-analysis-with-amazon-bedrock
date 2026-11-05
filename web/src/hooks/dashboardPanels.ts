/**
 * The dashboard's four independent reads (stats, citations, searches,
 * keywords). Each panel loads, fails and retries on its own, so one slow
 * route (a 504 on `/citations`) never blanks the others.
 */
import { apiGet } from '../api/client';
import { fetchAllKeywords } from '../api/keywordPages';
import { DASHBOARD_CITATIONS_LIMIT } from '../api/citationPages';
import { isStats } from '../types/domain/statsDecoders';
import type {
  Stats, Citations, Search, Keyword
} from '../types';

/** The dashboard's first page of recent searches (list rows, no answer text); the view loads older pages on demand. */
const DASHBOARD_SEARCHES_LIMIT = 100;

/** The panel requests: small first pages, so the dashboard never pulls a whole scope. */
export const DASHBOARD_PANEL_PATHS = [
  '/stats',
  `/citations?limit=${DASHBOARD_CITATIONS_LIMIT}`,
  `/searches?limit=${DASHBOARD_SEARCHES_LIMIT}`,
] as const;

export type DashboardPanel = 'stats' | 'citations' | 'searches' | 'keywords';

export const DASHBOARD_PANELS: readonly DashboardPanel[] = ['stats', 'citations', 'searches', 'keywords'];

/** What the dashboard says it could not load, per panel. */
export const DASHBOARD_PANEL_LABELS: Readonly<Record<DashboardPanel, string>> = {
  stats: 'Totals',
  citations: 'Citation and brand charts',
  searches: 'Recent searches',
  keywords: 'Keywords',
};

export interface DashboardPanelState {
  /** Why the last load of this panel failed; `null` once it loaded. */
  readonly error: string | null;
  /** A retry of this panel alone is in flight. */
  readonly retrying: boolean;
}

export type DashboardPanelStates = Readonly<Record<DashboardPanel, DashboardPanelState>>;

export const IDLE_PANEL: DashboardPanelState = {
  error: null,
  retrying: false,
};

export const IDLE_PANEL_STATES: DashboardPanelStates = {
  stats: IDLE_PANEL,
  citations: IDLE_PANEL,
  searches: IDLE_PANEL,
  keywords: IDLE_PANEL,
};

export interface SearchesPage {
  readonly searches: Search[];
  readonly nextToken: string | null;
}

/** A decoded panel payload; `null` when the payload had the wrong shape (the panel keeps what it had). */
export type DashboardPanelValue =
  | {
    readonly panel: 'stats';
    readonly value: Stats | null 
  }
  | {
    readonly panel: 'citations';
    readonly value: Citations | null 
  }
  | {
    readonly panel: 'searches';
    readonly value: SearchesPage | null 
  }
  | {
    readonly panel: 'keywords';
    readonly value: Keyword[] 
  };

function isCitations(value: unknown): value is Citations {
  return typeof value === 'object' && value !== null && 'provider_stats' in value;
}

/** @internal Response from the searches API */
interface SearchesResponse {
  searches: Search[];
  next_token?: string | null;
}

function isSearchesResponse(value: unknown): value is SearchesResponse {
  // Array check matters (AUDIT-2026-08-19 2.17): a key-only check let
  // `{"searches": null}` put null into Search[] state and blank the view.
  return typeof value === 'object' && value !== null && 'searches' in value && Array.isArray(value.searches);
}

function decodeSearchesPage(value: unknown): SearchesPage | null {
  if (!isSearchesResponse(value)) return null;
  return {
    searches: value.searches,
    nextToken: typeof value.next_token === 'string' ? value.next_token : null,
  };
}

/** One panel's read. Rejects with the request's error (status-coded `ApiRequestError`, abort, network). */
export async function loadDashboardPanel(panel: DashboardPanel, signal: AbortSignal): Promise<DashboardPanelValue> {
  switch (panel) {
    case 'stats': {
      const payload = await apiGet<unknown>(DASHBOARD_PANEL_PATHS[0], { signal });
      return {
        panel,
        value: isStats(payload) ? payload : null,
      };
    }
    case 'citations': {
      const payload = await apiGet<unknown>(DASHBOARD_PANEL_PATHS[1], { signal });
      return {
        panel,
        value: isCitations(payload) ? payload : null,
      };
    }
    case 'searches': {
      const payload = await apiGet<unknown>(DASHBOARD_PANEL_PATHS[2], { signal });
      return {
        panel,
        value: decodeSearchesPage(payload),
      };
    }
    case 'keywords':
      return {
        panel,
        value: await fetchAllKeywords({ signal }),
      };
  }
}
