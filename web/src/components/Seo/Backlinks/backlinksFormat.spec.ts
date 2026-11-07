import {
  describe, expect, it
} from 'vitest';
import { formatMetric } from './backlinksFormat';

describe('backlinks formats', () => {
  it('shows one decimal below 100 and whole numbers from 100', () => {
    expect([formatMetric(12.34), formatMetric(1234.5), formatMetric(null)]).toStrictEqual(['12.3', '1,235', '—']);
  });
});
