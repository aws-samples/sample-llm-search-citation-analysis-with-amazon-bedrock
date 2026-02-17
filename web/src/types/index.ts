/**
 * Central type exports - re-exports all types from domain and api subfolders.
 */

// Domain types (business entities)
export * from './domain';

// API response types
export * from './api/brandConfig';
export * from './api/responses';

/**
 * Navigation tab identifiers for the dashboard.
 */
export type TabType = 
  | 'dashboard' 
  | 'brands' 
  | 'citations'
  | 'visibility'
  | 'prompt-insights'
  | 'citation-gaps'
  | 'recommendations'
  | 'execution' 
  | 'schedule'
  | 'keyword-research'
  | 'content-studio'
  | 'settings'
  | 'searches'
  | 'raw-responses';
