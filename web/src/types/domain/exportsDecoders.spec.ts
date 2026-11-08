import {
  describe, expect, it
} from 'vitest';
import { buildExportSummary } from './exports-fixtures';
import {
  isExportsListResponse, isExportSummary 
} from './exportsDecoders';

describe('isExportSummary', () => {
  it('accepts a running export without the optional fields', () => {
    expect(isExportSummary(buildExportSummary())).toBe(true);
  });

  it('accepts a ready export with its download link', () => {
    expect(isExportSummary(buildExportSummary({
      status: 'ready',
      download_url: 'https://keywords.s3.amazonaws.com/exports/u/exp-coruna/citations.xlsx?X-Amz-Signature=abc',
      download_expires_at: '2026-11-06T09:16:00Z'
    }))).toBe(true);
  });

  it('accepts a failed export with its error', () => {
    expect(isExportSummary(buildExportSummary({
      status: 'failed',
      error: 'The keyword group no longer exists'
    }))).toBe(true);
  });

  it('accepts an export of a view without params', () => {
    expect(isExportSummary(buildExportSummary({
      view: 'alerts',
      params: {}
    }))).toBe(true);
  });

  it.each([
    ['an unknown view', { view: 'raw-responses' }],
    ['an unknown format', { format: 'pdf' }],
    ['an unknown status', { status: 'done' }],
    ['a non-string param', { params: { limit: 50 } }],
    ['params as a list', { params: ['group_id'] }],
    ['a fractional row count', { rows: 1.5 }],
    ['a negative byte count', { bytes: -1 }],
    ['a fractional cut-cell count', { truncated_cells: 0.5 }],
    ['a missing cut-cell count', { truncated_cells: undefined }],
    ['a missing filename', { filename: undefined }],
    ['a string notified flag', { notified: 'false' }],
    ['a null error', { error: null }],
    ['a numeric download link', { download_url: 42 }],
  ])('rejects %s', (_description, overrides) => {
    expect(isExportSummary({
      ...buildExportSummary(),
      ...overrides
    })).toBe(false);
  });

  it('rejects null', () => {
    expect(isExportSummary(null)).toBe(false);
  });
});

describe('isExportsListResponse', () => {
  it('accepts a page with a next token', () => {
    expect(isExportsListResponse({
      exports: [buildExportSummary(), buildExportSummary({ export_id: 'exp-vigo' })],
      next_token: 'eyJrIjoxfQ'
    })).toBe(true);
  });

  it('accepts the last page with a null next token', () => {
    expect(isExportsListResponse({
      exports: [],
      next_token: null
    })).toBe(true);
  });

  it('accepts a page without next_token', () => {
    expect(isExportsListResponse({ exports: [buildExportSummary()] })).toBe(true);
  });

  it('rejects a page holding one malformed export', () => {
    expect(isExportsListResponse({
      exports: [buildExportSummary(), { export_id: 'exp-vigo' }],
      next_token: null
    })).toBe(false);
  });

  it('rejects a numeric next token', () => {
    expect(isExportsListResponse({
      exports: [],
      next_token: 7
    })).toBe(false);
  });

  it('rejects a body without exports', () => {
    expect(isExportsListResponse({ next_token: null })).toBe(false);
  });
});
