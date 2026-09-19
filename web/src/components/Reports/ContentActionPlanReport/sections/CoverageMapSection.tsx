import type {
  CitationGapsResponse,
  ContentIdea,
  ContentStudioHistory,
} from '../../../../types';
import {
  ReportSection,
  ReportTable,
  type ReportTableColumn,
  pendingSectionPlaceholder,
} from '../../layout';
import type { ContentPlanSectionProps } from './ContentPlanSectionProps';

interface KeywordCoverage {
  keyword: string;
  gapCount: number;
  highPriorityGaps: number;
  briefCount: number;
  ideaCount: number;
}

const COLUMNS: ReadonlyArray<ReportTableColumn<KeywordCoverage>> = [
  {
    header: 'Keyword',
    cellClassName: 'font-medium',
    render: (row) => row.keyword,
  },
  {
    header: 'Gaps',
    render: (row) => row.gapCount,
  },
  {
    header: 'High priority',
    render: (row) => row.highPriorityGaps,
  },
  {
    header: 'Briefs ready',
    render: (row) => row.briefCount,
  },
  {
    header: 'Ideas queued',
    render: (row) => row.ideaCount,
  },
  {
    header: 'Status',
    cellClassName: 'text-xs',
    render: (row) => statusLabelFor(row),
  },
];

/**
 * The "where do we stand" matrix: every tracked keyword that appears in
 * citation gaps OR existing briefs OR open ideas, joined into one row.
 *
 * Highlights:
 *  - Rows where there are gaps but no brief and no idea: blocked work.
 *  - Rows where there is a brief but no gap data: content investments
 *    that may or may not be paying off (worth re-running analysis).
 *
 * The join is client-side because the citation-gaps and content-studio
 * endpoints don't share a foreign key. A backend rollup would be cleaner
 * but isn't blocking for the v1 of this report.
 */
export function CoverageMapSection({
  gaps,
  ideas,
  history,
  loading,
  error,
}: ContentPlanSectionProps) {
  const pending = pendingSectionPlaceholder({
    title: 'Coverage map',
    loading,
    loadingMessage: 'Building coverage map…',
    error,
  });
  if (pending) return pending;

  const rows = buildCoverageRows(gaps, ideas, history);

  if (rows.length === 0) {
    return null;
  }

  return (
    <ReportSection
      title="Coverage map"
      subtitle="Per-keyword snapshot: where the gaps are, what briefs already exist, and what ideas are queued up."
    >
      <ReportTable
        columns={COLUMNS}
        rows={rows}
        rowKey={(row) => row.keyword}
        rowClassName={statusRowClass}
        alignTop
      />
    </ReportSection>
  );
}

function buildCoverageRows(
  gaps: CitationGapsResponse | null,
  ideas: ReadonlyArray<ContentIdea>,
  history: ReadonlyArray<ContentStudioHistory>,
): KeywordCoverage[] {
  const map = new Map<string, KeywordCoverage>();

  const ensureRow = (keyword: string): KeywordCoverage => {
    const existing = map.get(keyword);
    if (existing) return existing;
    const fresh: KeywordCoverage = {
      keyword,
      gapCount: 0,
      highPriorityGaps: 0,
      briefCount: 0,
      ideaCount: 0,
    };
    map.set(keyword, fresh);
    return fresh;
  };

  for (const summary of gaps?.keyword_summaries ?? []) {
    const row = ensureRow(summary.keyword);
    row.gapCount = summary.gap_count;
    row.highPriorityGaps = summary.high_priority_gaps;
  }

  for (const item of history) {
    if (item.status !== 'generated') continue;
    const row = ensureRow(item.keyword);
    row.briefCount += 1;
  }

  for (const idea of ideas) {
    if (!idea.keyword) continue;
    const row = ensureRow(idea.keyword);
    row.ideaCount += 1;
  }

  // Sort: most blocked first (highest gaps with no briefs), then alphabetic.
  return Array.from(map.values()).sort((a, b) => {
    const aBlocked = a.gapCount > 0 && a.briefCount === 0 ? 1 : 0;
    const bBlocked = b.gapCount > 0 && b.briefCount === 0 ? 1 : 0;
    if (aBlocked !== bBlocked) return bBlocked - aBlocked;
    if (b.highPriorityGaps !== a.highPriorityGaps) {
      return b.highPriorityGaps - a.highPriorityGaps;
    }
    return a.keyword.localeCompare(b.keyword);
  });
}

function statusLabelFor(row: KeywordCoverage): string {
  if (row.gapCount === 0 && row.briefCount > 0) return 'Covered';
  if (row.gapCount > 0 && row.briefCount === 0 && row.ideaCount === 0) {
    return 'Blocked';
  }
  if (row.gapCount > 0 && row.ideaCount > 0 && row.briefCount === 0) {
    return 'Planned';
  }
  if (row.gapCount > 0 && row.briefCount > 0) return 'In progress';
  return '—';
}

function statusRowClass(row: KeywordCoverage): string {
  if (row.gapCount > 0 && row.briefCount === 0 && row.ideaCount === 0) {
    return 'bg-red-50 dark:bg-red-950/20';
  }
  return '';
}
