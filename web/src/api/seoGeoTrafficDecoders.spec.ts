import {
  describe, expect, it
} from 'vitest';
import {
  isSeoGeoResponse, isSeoGeoRow, isTrafficShareEntry
} from './seoDecoders';
import {
  BEYOND_TOP_ROW, buildSeoGeoResponse, TRAFFIC_COMPARISON
} from '../hooks/useSeoGeo-fixtures';
import { withoutField } from './seo-fixtures';

describe('SEO vs GEO estimated traffic guards', () => {
  it('accepts a row with a snapshot position and traffic', () => {
    expect(isSeoGeoRow(BEYOND_TOP_ROW)).toBe(true);
  });

  it('refuses a row with an unknown position source', () => {
    expect(isSeoGeoRow({
      ...BEYOND_TOP_ROW,
      organic_position_source: 'guess',
    })).toBe(false);
  });

  it('refuses a response without the traffic comparison', () => {
    expect(isSeoGeoResponse(withoutField(buildSeoGeoResponse(), 'traffic_comparison'))).toBe(false);
  });

  it('accepts a competitor without a snapshot', () => {
    expect(isTrafficShareEntry({
      ...TRAFFIC_COMPARISON[1],
      estimated_traffic: null,
      traffic_share: null,
    })).toBe(true);
  });
});
