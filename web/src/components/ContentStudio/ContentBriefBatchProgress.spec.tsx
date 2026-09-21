import {
  describe, expect, it
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import type { ContentBriefBatchCounts } from '../../types';
import { ContentBriefBatchProgress } from './ContentBriefBatchProgress';
import { buildProgressBatch } from './ContentStudioView-fixtures';

const spinnerCases: {
  testName: string;
  counts: Partial<ContentBriefBatchCounts>;
  expectedVisible: boolean;
}[] = [
  {
    testName: 'shows a spinner when only generating jobs remain',
    counts: { generating: 1 },
    expectedVisible: true,
  },
  {
    testName: 'hides the spinner when every job is terminal',
    counts: { generated: 1 },
    expectedVisible: false,
  },
];

const absentNoticeCases = [
  {
    testName: 'omits failure copy when no briefs fail',
    pattern: /failed\. Successful background jobs/iu,
  },
  {
    testName: 'omits unavailable copy when no tombstones are missing',
    pattern: /Manifest positions are preserved/u,
  },
];

describe('ContentBriefBatchProgress', () => {
  it.each(spinnerCases)('$testName', ({
    counts, expectedVisible
  }) => {
    const { container } = render(
      <ContentBriefBatchProgress batch={buildProgressBatch(counts)} />
    );

    expect(Boolean(container.querySelector('svg.animate-spin'))).toBe(expectedVisible);
  });

  it('uses plural failure copy when two briefs fail', () => {
    render(<ContentBriefBatchProgress batch={buildProgressBatch({
      failed: 2,
      total: 2,
    })} />);

    expect(screen.getByText(
      '2 briefs have failed. Successful background jobs are preserved.'
    )).toBeInTheDocument();
  });

  it('uses plural unavailable copy when two tombstones are missing', () => {
    render(<ContentBriefBatchProgress batch={buildProgressBatch({
      missing: 2,
      total: 2,
    })} />);

    expect(screen.getByText(/2 briefs are unavailable\./u)).toBeInTheDocument();
  });

  it.each(absentNoticeCases)('$testName', ({ pattern }) => {
    render(<ContentBriefBatchProgress batch={buildProgressBatch({ generated: 1 })} />);

    expect(screen.queryByText(pattern)).not.toBeInTheDocument();
  });
});
