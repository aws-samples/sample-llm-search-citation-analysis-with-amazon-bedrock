import { useEffect } from 'react';
import {
  useNavigate, useParams 
} from 'react-router-dom';
import { usePrintMode } from '../../../hooks/usePrintMode';
import { ReportLayout } from '../layout';
import type { Keyword } from '../../../types';
import { useBrandVisibilityReport } from './useBrandVisibilityReport';
import { PerKeywordHeadlineSection } from './sections/PerKeywordHeadlineSection';
import { BrandRankingsSection } from './sections/BrandRankingsSection';
import { TrendHistorySection } from './sections/TrendHistorySection';
import { CrossKeywordHeadlineSection } from './sections/CrossKeywordHeadlineSection';
import { PerKeywordTableSection } from './sections/PerKeywordTableSection';
import { MoversSection } from './sections/MoversSection';

interface Props {readonly keywords: ReadonlyArray<Keyword>;}

/**
 * Brand Visibility report. Two URL shapes:
 *   - `/reports/visibility` — all-keywords overview
 *   - `/reports/visibility/:keyword` — per-keyword deep cut
 *
 * The presence of `:keyword` is the mode switch. A keyword selector at
 * the top lets the user jump between modes from inside the report (it's
 * print-hidden so the PDF doesn't carry the dropdown).
 *
 * The marketing-lead audience reads this for "are we winning, level, or
 * losing", so the per-keyword variant is anchored on the gap to
 * competitor average and the all-keywords variant on improving vs
 * declining counts.
 */
export function BrandVisibilityReport({ keywords }: Props) {
  const params = useParams<{ keyword?: string }>();
  const navigate = useNavigate();

  const selected = params.keyword ? decodeURIComponent(params.keyword) : null;

  // Auto-redirect: if the user navigated to /reports/visibility/:keyword
  // with a slug that no longer matches any tracked keyword, fall back to
  // the all-keywords overview rather than render a confusing empty state.
  useEffect(() => {
    if (
      selected
      && keywords.length > 0
      && !keywords.some((k) => k.keyword === selected)
    ) {
      navigate('/reports/visibility', { replace: true });
    }
  }, [selected, keywords, navigate]);

  const data = useBrandVisibilityReport(selected);

  usePrintMode({ ready: data.ready });

  const subtitle = selected
    ? `Per-keyword visibility for "${selected}"`
    : 'Cross-keyword visibility overview';

  return (
    <ReportLayout
      title="Brand Visibility"
      subtitle={subtitle}
      actions={(
        <KeywordSwitcher
          selected={selected}
          keywords={keywords}
          onChange={(next) => {
            if (next === null) {
              navigate('/reports/visibility');
            } else {
              navigate(`/reports/visibility/${encodeURIComponent(next)}`);
            }
          }}
        />
      )}
    >
      {selected ? (
        <>
          <PerKeywordHeadlineSection
            visibility={data.visibility}
            trends={data.trends}
            loading={data.visibilityLoading || data.trendsLoading}
            error={data.visibilityError ?? data.trendsError}
          />
          <BrandRankingsSection
            visibility={data.visibility}
            loading={data.visibilityLoading}
            error={data.visibilityError}
          />
          <TrendHistorySection
            trends={data.trends}
            loading={data.trendsLoading}
            error={data.trendsError}
          />
        </>
      ) : (
        <>
          <CrossKeywordHeadlineSection
            trends={data.trends}
            loading={data.trendsLoading}
            error={data.trendsError}
          />
          <MoversSection
            trends={data.trends}
            loading={data.trendsLoading}
            error={data.trendsError}
          />
          <PerKeywordTableSection
            trends={data.trends}
            loading={data.trendsLoading}
            error={data.trendsError}
          />
        </>
      )}
    </ReportLayout>
  );
}

function KeywordSwitcher({
  selected,
  keywords,
  onChange,
}: {
  readonly selected: string | null;
  readonly keywords: ReadonlyArray<Keyword>;
  readonly onChange: (next: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor="visibility-mode" className="text-gray-600 dark:text-gray-400">
        Scope:
      </label>
      <select
        id="visibility-mode"
        value={selected ?? '__all__'}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === '__all__' ? null : v);
        }}
        className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
      >
        <option value="__all__">All keywords</option>
        {keywords.map((k) => (
          <option key={k.keyword} value={k.keyword}>{k.keyword}</option>
        ))}
      </select>
    </div>
  );
}
