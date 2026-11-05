import {
  describe, it, expect
} from 'vitest';
import { isCitationsPage } from './citationPages';
import { buildCitationsPage } from '../hooks/useMarketCitations-fixtures';

describe('isCitationsPage', () => {
  it('accepts a page without the provenance fields of older API builds', () => {
    expect(isCitationsPage(buildCitationsPage())).toBe(true);
  });

  it('accepts a page served from the citation rollup', () => {
    expect(isCitationsPage(buildCitationsPage({
      source: 'rollup',
      as_of: '2026-11-05T10:00:00Z',
      stale: false,
    }))).toBe(true);
  });

  it('accepts a live page with a null build time', () => {
    expect(isCitationsPage(buildCitationsPage({
      source: 'live',
      as_of: null,
      stale: true,
    }))).toBe(true);
  });

  it('rejects an unknown source', () => {
    expect(isCitationsPage({
      ...buildCitationsPage(),
      source: 'cache',
    })).toBe(false);
  });

  it('rejects a build time that is not a string', () => {
    expect(isCitationsPage({
      ...buildCitationsPage(),
      as_of: 1_730_800_000,
    })).toBe(false);
  });

  it('rejects a stale flag that is not a boolean', () => {
    expect(isCitationsPage({
      ...buildCitationsPage(),
      stale: 'yes',
    })).toBe(false);
  });
});
