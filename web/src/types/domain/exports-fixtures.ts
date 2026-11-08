/**
 * Export summaries for the decoder specs.
 */
import type { ExportSummary } from './exports';

export function buildExportSummary(overrides: Partial<ExportSummary> = {}): ExportSummary {
  return {
    export_id: 'exp-coruna',
    view: 'citations',
    params: {
      group_id: 'group-coruna',
      market_id: 'es-es'
    },
    format: 'xlsx',
    status: 'running',
    created_at: '2026-11-06T09:00:00Z',
    updated_at: '2026-11-06T09:01:00Z',
    rows: 12000,
    truncated_cells: 0,
    bytes: 524288,
    filename: 'citations-group-coruna.xlsx',
    notified: false,
    ...overrides,
  };
}
