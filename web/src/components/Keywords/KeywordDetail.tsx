import {
  useState, useEffect 
} from 'react';
import {
  API_BASE_URL, authenticatedFetch 
} from '../../infrastructure';
import type { Search } from '../../types';
import { Spinner } from '../ui/Spinner';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import {
  Bar, Line 
} from 'react-chartjs-2';
import {
  KeywordStats,
  groupSearchesByTime,
  buildChartData,
  lineChartOptions,
  barChartOptions,
  DetailHeader,
  SearchItem,
} from './KeywordDetailComponents';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend
);

interface KeywordDetailProps {
  keyword: string;
  onClose: () => void;
  onRerun?: (keyword: string) => void;
  onNavigateToRawResponses?: (path: string) => void;
}

interface SearchResponse {searches?: Search[];}

function isSearchResponse(value: unknown): value is SearchResponse {
  return value !== null && typeof value === 'object';
}

export const KeywordDetail = ({
  keyword,
  onClose,
  onNavigateToRawResponses,
}: KeywordDetailProps) => {
  const [stats, setStats] = useState<KeywordStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedRun, setExpandedRun] = useState<number | null>(null);
  const [expandedResponse, setExpandedResponse] = useState<number | null>(null);

  useEffect(() => {
    fetchKeywordStats();
  }, [keyword]);

  const fetchKeywordStats = async () => {
    try {
      setLoading(true);
      const response = await authenticatedFetch(
        `${API_BASE_URL}/searches?keyword=${encodeURIComponent(keyword)}`
      );
      const json: unknown = await response.json();
      const data: SearchResponse = isSearchResponse(json) ? json : { searches: [] };
      const searches: Search[] = data.searches ?? [];

      const totalCitations = searches.reduce(
        (sum: number, s: Search) => sum + (s.citations?.length ?? 0),
        0
      );
      const searchCount = searches.length;
      const firstSearch = searchCount > 0 ? searches[0] : null;
      const sortedSearches = [...searches].sort(
        (a: Search, b: Search) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      setStats({
        totalRuns: searchCount,
        totalCitations,
        avgCitationsPerRun: searchCount > 0 ? totalCitations / searchCount : 0,
        lastRun: firstSearch?.timestamp ?? '',
        searches: sortedSearches,
      });
    } catch (err) {
      console.error('Error fetching keyword stats:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <LoadingOverlay />;
  }

  if (!stats) {
    return null;
  }

  const runBatches = groupSearchesByTime(stats.searches);
  const {
    lineChartData, barChartData 
  } = buildChartData(stats.searches, runBatches);

  const buildRawResponsesPath = (search: Search): string => {
    const date = new Date(search.timestamp);
    const isoString = date.toISOString();
    const dateStr = isoString.slice(0, 10);
    const lowerKeyword = keyword.toLowerCase();
    const keywordSlug = lowerKeyword
      .replaceAll(/\s+/g, '-')
      .replaceAll(/[^a-z0-9-]/g, '');
    const provider = search.provider.toLowerCase();
    return `${dateStr}/${keywordSlug}/${provider}`;
  };

  return (
    <div className="fixed top-0 left-0 right-0 bottom-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] p-4 overflow-y-auto">
      <div className="bg-gray-50 rounded-lg max-w-6xl w-full max-h-[90vh] overflow-y-auto">
        <DetailHeader keyword={keyword} stats={stats} onClose={onClose} />

        <div className="p-4 sm:p-6 space-y-6">
          <ChartsSection lineChartData={lineChartData} barChartData={barChartData} />

          <RunHistory
            runBatches={runBatches}
            stats={stats}
            expandedRun={expandedRun}
            setExpandedRun={setExpandedRun}
            expandedResponse={expandedResponse}
            setExpandedResponse={setExpandedResponse}
            onNavigateToRawResponses={onNavigateToRawResponses}
            buildRawResponsesPath={buildRawResponsesPath}
          />
        </div>
      </div>
    </div>
  );
};

const LoadingOverlay = () => (
  <div className="fixed top-0 left-0 right-0 bottom-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]">
    <div className="bg-white rounded-lg p-8">
      <Spinner size="lg" className="mx-auto" />
      <p className="mt-4 text-gray-600">Loading keyword details...</p>
    </div>
  </div>
);

interface ChartsSectionProps {
  lineChartData: ReturnType<typeof buildChartData>['lineChartData'];
  barChartData: ReturnType<typeof buildChartData>['barChartData'];
}

const ChartsSection = ({
  lineChartData, barChartData 
}: ChartsSectionProps) => (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
    <div className="bg-gray-50 p-3 sm:p-4 rounded-lg">
      <h3 className="font-semibold text-gray-900 mb-4 text-sm sm:text-base">Citations Trend</h3>
      <Line data={lineChartData} options={lineChartOptions} />
    </div>
    <div className="bg-gray-50 p-3 sm:p-4 rounded-lg">
      <h3 className="font-semibold text-gray-900 mb-4 text-sm sm:text-base">Top 10 Citations</h3>
      <Bar data={barChartData} options={barChartOptions} />
    </div>
  </div>
);

interface RunHistoryProps {
  runBatches: Record<string, Search[]>;
  stats: KeywordStats;
  expandedRun: number | null;
  setExpandedRun: (value: number | null) => void;
  expandedResponse: number | null;
  setExpandedResponse: (value: number | null) => void;
  onNavigateToRawResponses?: (path: string) => void;
  buildRawResponsesPath: (search: Search) => string;
}

const RunHistory = ({
  runBatches,
  stats,
  expandedRun,
  setExpandedRun,
  expandedResponse,
  setExpandedResponse,
  onNavigateToRawResponses,
  buildRawResponsesPath,
}: RunHistoryProps) => {
  const batchEntries = Object.entries(runBatches);

  return (
    <div>
      <h3 className="font-semibold text-gray-900 mb-4">Run History</h3>
      <div className="space-y-4">
        {batchEntries.map(([timeKey, batchSearches], batchIdx) => {
          const batchNumber = batchEntries.length - batchIdx;
          return (
            <BatchCard
              key={timeKey}
              timeKey={timeKey}
              batchNumber={batchNumber}
              batchSearches={batchSearches}
              stats={stats}
              expandedRun={expandedRun}
              setExpandedRun={setExpandedRun}
              expandedResponse={expandedResponse}
              setExpandedResponse={setExpandedResponse}
              onNavigateToRawResponses={onNavigateToRawResponses}
              buildRawResponsesPath={buildRawResponsesPath}
            />
          );
        })}
      </div>
    </div>
  );
};

interface BatchCardProps {
  timeKey: string;
  batchNumber: number;
  batchSearches: Search[];
  stats: KeywordStats;
  expandedRun: number | null;
  setExpandedRun: (value: number | null) => void;
  expandedResponse: number | null;
  setExpandedResponse: (value: number | null) => void;
  onNavigateToRawResponses?: (path: string) => void;
  buildRawResponsesPath: (search: Search) => string;
}

const BatchCard = ({
  timeKey,
  batchNumber,
  batchSearches,
  stats,
  expandedRun,
  setExpandedRun,
  expandedResponse,
  setExpandedResponse,
  onNavigateToRawResponses,
  buildRawResponsesPath,
}: BatchCardProps) => (
  <div className="border-2 border-gray-300 rounded-lg p-3 bg-gray-50">
    <div className="text-sm font-semibold text-gray-700 mb-2 px-2">
      Batch #{batchNumber} - {timeKey}
    </div>
    <div className="space-y-2">
      {batchSearches.map((search) => {
        const globalIdx = stats.searches.indexOf(search);
        return (
          <SearchItem
            key={globalIdx}
            search={search}
            globalIdx={globalIdx}
            isExpanded={expandedRun === globalIdx}
            onToggle={() => setExpandedRun(expandedRun === globalIdx ? null : globalIdx)}
            expandedResponse={expandedResponse}
            setExpandedResponse={setExpandedResponse}
            onNavigateToRawResponses={onNavigateToRawResponses}
            buildRawResponsesPath={buildRawResponsesPath}
          />
        );
      })}
    </div>
  </div>
);
