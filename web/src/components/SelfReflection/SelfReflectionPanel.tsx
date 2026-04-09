import { useSelfReflection } from '../../hooks/useSelfReflection';
import { Spinner } from '../ui/Spinner';
import type { ContentRecommendation } from '../../types';

interface SelfReflectionPanelProps {
  readonly keyword: string;
  readonly brand: string;
  readonly queryPromptId: string;
}

const PRIORITY_BADGE_CLASSES: Record<ContentRecommendation['priority'], string> = {
  high: 'bg-red-100 text-red-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-green-100 text-green-800',
};

export function SelfReflectionPanel({ keyword, brand, queryPromptId }: SelfReflectionPanelProps) {
  const { data, loading, error, triggerReflection } = useSelfReflection();

  const handleAnalyse = () => {
    triggerReflection(keyword, brand, queryPromptId);
  };

  const handleReanalyse = () => {
    triggerReflection(keyword, brand, queryPromptId, true);
  };

  const displayRank = data?.current_rank != null ? String(data.current_rank) : 'Not ranked';

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Ranking Analysis</h3>
        <p className="text-sm text-gray-500 mt-1">
          Understand why {brand} ranks where it does for &quot;{keyword}&quot;
        </p>
      </div>

      {!data && !loading && (
        <button
          type="button"
          onClick={handleAnalyse}
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
        >
          Analyse Ranking
        </button>
      )}

      {data && !loading && (
        <button
          type="button"
          onClick={handleReanalyse}
          className="px-3 py-1.5 bg-gray-100 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-200 transition-colors mb-4"
        >
          Re-analyse
        </button>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
          <Spinner size="sm" />
          <span>Analysing ranking factors...</span>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 mt-2">{error}</p>
      )}

      {data && (
        <div className="mt-6 space-y-5">
          <section>
            <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wide">Current Rank</h4>
            <p className="mt-1 text-2xl font-bold text-gray-900">{displayRank}</p>
          </section>

          <section>
            <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wide">Explanation</h4>
            <p className="mt-1 text-sm text-gray-700 leading-relaxed">{data.explanation}</p>
          </section>

          <section>
            <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wide">Content Contributions</h4>
            <p className="mt-1 text-sm text-gray-700 leading-relaxed">{data.content_contributions}</p>
          </section>

          <section>
            <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wide">Competitor Advantages</h4>
            <p className="mt-1 text-sm text-gray-700 leading-relaxed">{data.competitor_advantages}</p>
          </section>

          <section>
            <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wide">Missing Data Points</h4>
            <p className="mt-1 text-sm text-gray-700 leading-relaxed">{data.missing_data_points}</p>
          </section>

          {data.recommendations.length > 0 && (
            <section>
              <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">Recommendations</h4>
              <ul className="space-y-3">
                {data.recommendations.map((rec) => (
                  <li key={rec.title} className="border border-gray-100 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-gray-900">{rec.title}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PRIORITY_BADGE_CLASSES[rec.priority]}`}>
                        {rec.priority}
                      </span>
                      <span className="text-xs text-gray-400">{rec.content_type}</span>
                    </div>
                    <p className="text-sm text-gray-600">{rec.description}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="pt-2">
            <a href="/content-studio" className="text-sm text-blue-600 hover:text-blue-800 font-medium">
              View in Content Studio
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export default SelfReflectionPanel;
