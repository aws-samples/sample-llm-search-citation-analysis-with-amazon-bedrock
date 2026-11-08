import {
  describe, expect, it
} from 'vitest';
import { buildExportSummary } from '../types/domain/exports-fixtures';
import {
  appendPage, countUnseen, finishedBetween, markedSeen, mergeFirstPage
} from './exportsState';

const NEW = buildExportSummary({
  export_id: 'e3',
  created_at: '2026-11-06T12:00:00Z',
});
const MID = buildExportSummary({
  export_id: 'e2',
  created_at: '2026-11-06T11:00:00Z',
});
const OLD = buildExportSummary({
  export_id: 'e1',
  created_at: '2026-11-06T10:00:00Z',
});

describe('mergeFirstPage', () => {
  it('keeps the older exports a later page loaded when the first page has more after it', () => {
    expect(mergeFirstPage([MID, OLD], [NEW, MID], true).map((item) => item.export_id)).toStrictEqual(['e3', 'e2', 'e1']);
  });

  it('is the first page alone when it is the whole list', () => {
    expect(mergeFirstPage([MID, OLD], [NEW], false).map((item) => item.export_id)).toStrictEqual(['e3']);
  });

  it('drops a loaded export missing from the first page and newer than its last row', () => {
    expect(mergeFirstPage([NEW, MID, OLD], [NEW, OLD], true).map((item) => item.export_id)).toStrictEqual(['e3', 'e1']);
  });
});

describe('appendPage', () => {
  it('appends a page and skips exports already listed', () => {
    expect(appendPage([NEW, MID], [MID, OLD]).map((item) => item.export_id)).toStrictEqual(['e3', 'e2', 'e1']);
  });
});

describe('finishedBetween', () => {
  it('finds a running export that became ready', () => {
    const ready = {
      ...MID,
      status: 'ready' as const,
    };

    expect(finishedBetween([MID], [ready])).toStrictEqual([ready]);
  });

  it('ignores an export that was already finished or got cancelled', () => {
    const doneBefore = buildExportSummary({
      export_id: 'e9',
      status: 'ready',
    });
    const cancelled = {
      ...MID,
      status: 'cancelled' as const,
    };

    expect(finishedBetween([doneBefore, MID], [doneBefore, cancelled])).toStrictEqual([]);
  });
});

describe('countUnseen and markedSeen', () => {
  it('counts finished exports not seen yet', () => {
    expect(countUnseen([
      buildExportSummary({ status: 'ready' }),
      buildExportSummary({ status: 'failed' }),
      buildExportSummary({ status: 'running' }),
    ])).toBe(2);
  });

  it('marks only the given exports seen', () => {
    const marked = markedSeen([NEW, MID], new Set(['e2']));

    expect(marked.map((item) => item.notified)).toStrictEqual([false, true]);
  });
});
