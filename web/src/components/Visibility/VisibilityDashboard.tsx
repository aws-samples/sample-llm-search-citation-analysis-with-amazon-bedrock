import {
  useEffect, useState 
} from 'react';
import { useVisibilityMetrics } from '../../hooks/useVisibilityMetrics';
import { useHistoricalTrends } from '../../hooks/useHistoricalTrends';
import {
  BrandRow, SummaryCards, TrendChart 
} from './VisibilityComponents';

interface Props { readonly keywords: Array<{ keyword: string }>; }

export function VisibilityDashboard({ keywords }: Props) {
  const [selectedKeyword, setSelectedKeyword] = useState<string>('');
  const {
    data: visibility, loading: visLoading, fetchVisibilityMetrics 
  } = useVisibilityMetrics();
  const {
    data: trends, loading: trendsLoading, fetchHistoricalTrends 
  } = useHistoricalTrends();

  useEffect(() => {
    if (keywords.length > 0 && !selectedKeyword) setSelectedKeyword(keywords[0].keyword);
  }, [keywords, selectedKeyword]);

  useEffect(() => {
    if (selectedKeyword) {
      fetchVisibilityMetrics(selectedKeyword);
      fetchHistoricalTrends(selectedKeyword, 'day', 30);
    }
  }, [selectedKeyword, fetchVisibilityMetrics, fetchHistoricalTrends]);

  const hasTrendData = trends?.trend_data && trends.trend_data.length > 0;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
        <div className="flex flex-col gap-4">
          <div className="flex-1">
            <h2 className="text-lg sm:text-xl font-semibold text-gray-900">Visibility Dashboard</h2>
            <p className="text-sm text-gray-500 mt-2 leading-relaxed">Track how visible your brand is across AI search engines compared to competitors.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Analyze keyword</label>
            <select value={selectedKeyword} onChange={(e) => setSelectedKeyword(e.target.value)} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 text-sm bg-gray-50">
              {keywords.map(k => <option key={k.keyword} value={k.keyword}>{k.keyword}</option>)}
            </select>
          </div>
        </div>
      </div>

      {(visLoading || trendsLoading) && <div className="text-center py-8 text-gray-500">Loading visibility data...</div>}

      {visibility && (
        <>
          <SummaryCards
            firstPartyScore={visibility.summary?.first_party_avg_score}
            competitorScore={visibility.summary?.competitor_avg_score}
            shareOfVoice={visibility.summary?.first_party_total_sov}
            trendDirection={trends?.trend_direction}
            trendChange={trends?.summary?.change}
          />

          {hasTrendData && <TrendChart data={trends.trend_data} />}

          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200">
              <h3 className="text-lg font-medium">Brand Rankings</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Brand</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Score</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Share of Voice</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Best Rank</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Mentions</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Providers</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {visibility.brands?.map((brand, i) => <BrandRow key={brand.name} brand={brand} index={i} />) ?? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No brand data available.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default VisibilityDashboard;
