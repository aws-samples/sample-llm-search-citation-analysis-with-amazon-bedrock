import type {
  HistoricalTrendsResponse, PersonaRankingsResponse, VisibilityMetricsResponse 
} from '../../types';
import {
  BrandRow, SummaryCards, TrendChart 
} from './VisibilityComponents';
import { PersonaComparisonChart } from './PersonaComparisonChart';

interface KeywordVisibilityPanelProps {
  readonly visibility: VisibilityMetricsResponse;
  readonly trends: HistoricalTrendsResponse | null;
  readonly personaRankings: PersonaRankingsResponse | null;
}

const RANKING_COLUMNS = ['Brand', 'Score', 'Share of Voice', 'Best Rank', 'Mentions', 'Providers', 'Type'];

function BrandRankingsTable({ visibility }: { readonly visibility: VisibilityMetricsResponse }) {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200">
        <h3 className="text-lg font-medium">Brand Rankings</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {RANKING_COLUMNS.map((column) => (
                <th key={column} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{column}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {visibility.brands.length > 0 ? visibility.brands.map((brand, i) => <BrandRow key={brand.name} brand={brand} index={i} />) : (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No brand data available.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The classic single-keyword view: score cards, the 30-day trend, the brand
 * ranking table and how each persona ranks the brands.
 */
export function KeywordVisibilityPanel({
  visibility, trends, personaRankings 
}: KeywordVisibilityPanelProps) {
  const hasTrendData = trends?.trend_data && trends.trend_data.length > 0;

  return (
    <>
      <SummaryCards
        firstPartyScore={visibility.summary.first_party_avg_score}
        competitorScore={visibility.summary.competitor_avg_score}
        shareOfVoice={visibility.summary.first_party_total_sov}
        prominence={visibility.prominence}
        trendDirection={trends?.trend_direction}
        trendChange={trends?.summary?.change}
      />

      {hasTrendData && <TrendChart data={trends.trend_data} />}

      <BrandRankingsTable visibility={visibility} />

      <PersonaComparisonChart data={personaRankings} />
    </>
  );
}
