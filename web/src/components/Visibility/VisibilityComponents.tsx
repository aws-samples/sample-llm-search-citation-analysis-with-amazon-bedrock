import type { BrandVisibilityMetric } from '../../types';

const getScoreColor = (score: number) => {
  if (score >= 70) return 'text-green-600';
  if (score >= 40) return 'text-yellow-600';
  return 'text-red-600';
};

const getClassBadge = (c: string) => {
  if (c === 'first_party') return 'bg-green-100 text-green-800';
  if (c === 'competitor') return 'bg-red-100 text-red-800';
  return 'bg-gray-100 text-gray-800';
};

export function BrandRow({
  brand, index 
}: {
  readonly brand: BrandVisibilityMetric;
  readonly index: number 
}) {
  return (
    <tr className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
      <td className="px-4 py-3 text-sm font-medium text-gray-900">{brand.name}</td>
      <td className={`px-4 py-3 text-sm font-bold ${getScoreColor(brand.visibility_score)}`}>
        {brand.visibility_score}
      </td>
      <td className="px-4 py-3 text-sm text-gray-600">{brand.share_of_voice.toFixed(1)}%</td>
      <td className="px-4 py-3 text-sm text-gray-600">{brand.best_rank ?? '-'}</td>
      <td className="px-4 py-3 text-sm text-gray-600">{brand.total_mentions}</td>
      <td className="px-4 py-3 text-sm">
        <div className="flex gap-1">
          {brand.providers.map(p => (
            <span key={p} className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">{p}</span>
          ))}
        </div>
      </td>
      <td className="px-4 py-3 text-sm">
        <span className={`px-2 py-1 rounded text-xs ${getClassBadge(brand.classification)}`}>
          {brand.classification.replace('_', ' ')}
        </span>
      </td>
    </tr>
  );
}

export function TrendIcon({ direction }: { readonly direction: string }) {
  if (direction === 'improving') {
    return (
      <svg className="w-5 h-5 inline text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
      </svg>
    );
  }
  if (direction === 'declining') {
    return (
      <svg className="w-5 h-5 inline text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 6L9 12.75l4.286-4.286a11.948 11.948 0 014.306 6.43l.776 2.898m0 0l3.182-5.511m-3.182 5.51l-5.511-3.181" />
      </svg>
    );
  }
  return (
    <svg className="w-5 h-5 inline text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.25 8.25L21 12m0 0l-3.75 3.75M21 12H3" />
    </svg>
  );
}

interface SummaryCardsProps {
  readonly firstPartyScore: number | undefined;
  readonly competitorScore: number | undefined;
  readonly shareOfVoice: number | undefined;
  readonly trendDirection: string | undefined;
  readonly trendChange: number | undefined;
}

function ScoreCard({
  label, score, borderColor, textColor 
}: {
  readonly label: string;
  readonly score: number | undefined;
  readonly borderColor: string;
  readonly textColor?: string 
}) {
  const color = textColor ?? getScoreColor(score ?? 0);
  return (
    <div className={`bg-white p-3 sm:p-4 rounded-lg shadow border-l-4 ${borderColor}`}>
      <div className="text-xs sm:text-sm text-gray-500">{label}</div>
      <div className={`text-xl sm:text-2xl font-bold ${color}`}>{score?.toFixed(1) ?? 'N/A'}</div>
    </div>
  );
}

export function SummaryCards({
  firstPartyScore, competitorScore, shareOfVoice, trendDirection, trendChange 
}: SummaryCardsProps) {
  const trendPrefix = (trendChange ?? 0) >= 0 ? '+' : '';
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      <ScoreCard label="Your Avg Score" score={firstPartyScore} borderColor="border-green-500" />
      <ScoreCard label="Competitor Avg" score={competitorScore} borderColor="border-red-500" />
      <ScoreCard label="Share of Voice" score={shareOfVoice} borderColor="border-blue-500" textColor="text-blue-600" />
      <div className="bg-white p-3 sm:p-4 rounded-lg shadow border-l-4 border-purple-500">
        <div className="text-xs sm:text-sm text-gray-500">Trend</div>
        <div className="text-xl sm:text-2xl font-bold">
          {trendDirection && <><TrendIcon direction={trendDirection} /> {trendPrefix}{trendChange ?? 0}</>}
        </div>
      </div>
    </div>
  );
}

interface TrendChartProps {
  readonly data: Array<{
    period: string;
    visibility_score: number 
  }>;
}

export function TrendChart({ data }: TrendChartProps) {
  return (
    <div className="bg-white p-4 rounded-lg shadow">
      <h3 className="text-lg font-medium mb-4">Visibility Trend (Last 30 Days)</h3>
      <div className="h-48 flex items-end gap-1">
        {data.map((point, i) => (
          <div key={point.period} className="flex-1 flex flex-col items-center">
            <div className="w-full bg-blue-500 rounded-t" style={{ height: `${(point.visibility_score / 100) * 180}px` }} title={`${point.period}: ${point.visibility_score}`} />
            {i % 5 === 0 && <div className="text-xs text-gray-400 mt-1 transform -rotate-45">{point.period.slice(5)}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export { getScoreColor };
