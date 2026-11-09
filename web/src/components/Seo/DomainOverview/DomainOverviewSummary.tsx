import type {
  DomainOverviewResponse, PositionBucket
} from '../../../types/api/seoDomains';
import { ReportStatCard } from '../../Reports/layout/ReportStatCard';
import { ReportStatGrid } from '../../Reports/layout/ReportStatGrid';
import {
  Chip, positionTone, type PositionTone
} from '../../ui/tableCells';
import {
  CACHED_NOTE, compactText, compactUsdText, integerText, usdText
} from './domainFormat';

interface Props {readonly overview: DomainOverviewResponse;}

const ESTIMATE_NOTE = 'Estimated by DataForSEO from search volume and ranking position, not measured clicks.';

const BAR_TONES: Record<PositionTone, string> = {
  green: 'bg-emerald-500',
  blue: 'bg-blue-500',
  amber: 'bg-amber-400',
  neutral: 'bg-gray-300',
};

/** The tone of a bucket from its best position (`4-10` → 4). */
function bucketTone(bucket: PositionBucket): PositionTone {
  const best = Number.parseInt(bucket.label, 10);
  return Number.isNaN(best) ? 'neutral' : positionTone(best);
}

/** The exact figure under a compacted one ("1,234,567 exactly"); none when nothing was cut. */
function exactNote(shown: string, exact: string): string | undefined {
  return shown === exact ? undefined : `${exact} exactly`;
}

/** Keywords per Google position: a stacked bar and one figure per bucket. */
function PositionDistribution({ buckets }: { readonly buckets: readonly PositionBucket[] }) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.keywords, 0);
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Keywords per Google position</h4>
      {total > 0 && (
        <div aria-hidden="true" className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100">
          {buckets.map((bucket) => (
            <div key={bucket.label} className={BAR_TONES[bucketTone(bucket)]} style={{ width: `${(bucket.keywords / total) * 100}%` }} />
          ))}
        </div>
      )}
      <dl className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {buckets.map((bucket) => (
          <div key={bucket.label} className="rounded-lg border border-gray-100 px-3 py-2">
            <dt className="text-xs text-gray-500 whitespace-nowrap">
              <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${BAR_TONES[bucketTone(bucket)]}`} aria-hidden="true" />
              {`#${bucket.label}`}
            </dt>
            <dd className="text-base font-semibold tabular-nums text-gray-900" title={integerText(bucket.keywords)}>{compactText(bucket.keywords)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The overview figures: keywords, estimated traffic and its ads value, and keywords per position bucket. */
export function DomainOverviewSummary({ overview }: Props) {
  const keywords = compactText(overview.organic_keywords);
  const traffic = compactText(overview.estimated_traffic);
  const value = compactUsdText(overview.traffic_cost);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold text-gray-900 break-all">{overview.hostname}</h3>
        {overview.domain_wide && <Chip>With subdomains</Chip>}
        {overview.cached && <Chip tone="blue" title={CACHED_NOTE}>Cached</Chip>}
        <span className="text-xs text-gray-500">Updated {overview.fetched_at.slice(0, 16).replace('T', ' ')} UTC</span>
      </div>
      {overview.has_data ? (
        <section aria-label="Domain overview" className="space-y-4">
          <ReportStatGrid columns={3}>
            <ReportStatCard label="Organic keywords" value={keywords} info="Keywords the domain ranks for in Google's top 100."
              footnote={exactNote(keywords, integerText(overview.organic_keywords))} />
            <ReportStatCard label="Est. organic traffic / month" value={traffic} info="Monthly visits DataForSEO expects from the positions and search volumes."
              footnote={exactNote(traffic, integerText(overview.estimated_traffic))} />
            <ReportStatCard label="Est. traffic value / month" value={value} info="What the estimated traffic would cost as Google Ads clicks."
              footnote={exactNote(value, usdText(overview.traffic_cost))} />
          </ReportStatGrid>
          <PositionDistribution buckets={overview.position_buckets} />
          <p className="text-xs text-gray-500">
            {overview.domain_wide ? `Figures cover all of ${overview.hostname} and its subdomains. ` : ''}
            {overview.cached ? `${ESTIMATE_NOTE} ${CACHED_NOTE}.` : ESTIMATE_NOTE}
          </p>
        </section>
      ) : (
        <p className="text-sm text-gray-600">{`DataForSEO has no organic ranking data for ${overview.hostname} in this market.`}</p>
      )}
    </div>
  );
}
