import type {
  AggregatedBrand, ProviderBrandData 
} from '../../types';

interface BrandOverviewTabProps {
  brand: AggregatedBrand;
  providerData: ProviderBrandData[];
}

export const BrandOverviewTab = ({ brand }: BrandOverviewTabProps) => {
  const getClassificationColor = (classification: string) => {
    switch (classification) {
      case 'first_party':
        return 'bg-green-50 text-green-600 border-green-200';
      case 'competitor':
        return 'bg-red-50 text-red-600 border-red-200';
      default:
        return 'bg-gray-50 text-gray-600 border-gray-200';
    }
  };

  const getClassificationLabel = (classification: string) => {
    switch (classification) {
      case 'first_party':
        return 'First Party';
      case 'competitor':
        return 'Competitor';
      default:
        return 'Other';
    }
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4">
        <div className="bg-blue-50 rounded-lg p-3 sm:p-4">
          <div className="text-xs sm:text-sm text-blue-600 font-medium">Overall Rank</div>
          <div className="text-2xl sm:text-3xl font-bold text-blue-900 mt-1">#{brand.overall_rank}</div>
        </div>
        <div className="bg-green-50 rounded-lg p-3 sm:p-4">
          <div className="text-xs sm:text-sm text-green-600 font-medium">AI Providers</div>
          <div className="text-2xl sm:text-3xl font-bold text-green-900 mt-1">{brand.provider_count}</div>
        </div>
        <div className="bg-purple-50 rounded-lg p-3 sm:p-4">
          <div className="text-xs sm:text-sm text-purple-600 font-medium">Total Mentions</div>
          <div className="text-2xl sm:text-3xl font-bold text-purple-900 mt-1">{brand.total_mentions}</div>
        </div>
        <div className="bg-orange-50 rounded-lg p-3 sm:p-4">
          <div className="text-xs sm:text-sm text-orange-600 font-medium">Aggregate Score</div>
          <div className="text-2xl sm:text-3xl font-bold text-orange-900 mt-1">{brand.aggregate_score}</div>
        </div>
        <div className={`rounded-lg p-3 sm:p-4 border col-span-2 sm:col-span-1 ${getClassificationColor(brand.classification)}`}>
          <div className="text-xs sm:text-sm font-medium">Classification</div>
          <div className="text-lg sm:text-xl font-bold mt-1">{getClassificationLabel(brand.classification)}</div>
        </div>
      </div>

      {/* Provider Breakdown */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 sm:p-6">
        <h3 className="text-base sm:text-lg font-bold text-gray-900 mb-4">Provider Breakdown</h3>
        <div className="space-y-3">
          {brand.appearances.map((appearance) => {
            const getSentimentColor = (sentiment: string | undefined) => {
              if (sentiment === 'positive') return 'text-green-600';
              if (sentiment === 'negative') return 'text-red-600';
              return 'text-gray-600';
            };
            return (
              <div key={`${appearance.provider}-${appearance.rank}-${appearance.mention_count}`} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                <div className="flex items-center gap-3">
                  <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded font-medium text-sm">
                    {appearance.provider.toUpperCase()}
                  </span>
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      Rank #{appearance.rank} • {appearance.mention_count} mention(s)
                    </div>
                    {appearance.sentiment && (
                      <div className="text-xs text-gray-600 mt-1">
                        Sentiment: <span className={`font-medium ${getSentimentColor(appearance.sentiment)}`}>{appearance.sentiment}</span>
                        {appearance.sentiment_reason ? ` - ${appearance.sentiment_reason}` : ''}
                      </div>
                    )}
                    {appearance.ranking_context && (
                      <div className="text-xs text-gray-600 mt-1">
                        Context: <span className="italic">{appearance.ranking_context}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-gray-900">
                    {appearance.rank === brand.best_rank && (
                      <span className="text-emerald-600">Best Rank</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sentiment Summary */}
      {brand.appearances.some(a => a.sentiment) && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 sm:p-6">
          <h3 className="text-base sm:text-lg font-bold text-gray-900 mb-4">Sentiment Analysis</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            {['positive', 'neutral', 'negative', 'mixed'].map(sentiment => {
              const count = brand.appearances.filter(a => a.sentiment === sentiment).length;
              const percentage = brand.appearances.length > 0 
                ? Math.round((count / brand.appearances.length) * 100) 
                : 0;
              
              const getSentimentSummaryColor = (s: string) => {
                if (s === 'positive') return 'text-green-600';
                if (s === 'negative') return 'text-red-600';
                if (s === 'mixed') return 'text-yellow-600';
                return 'text-gray-600';
              };
              
              return (
                <div key={sentiment} className="text-center p-3 bg-gray-50 rounded">
                  <div className={`text-xl sm:text-2xl font-bold ${getSentimentSummaryColor(sentiment)}`}>
                    {count}
                  </div>
                  <div className="text-xs text-gray-500 capitalize">{sentiment}</div>
                  <div className="text-xs text-gray-400">{percentage}%</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Scoring Explanation */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-gray-900 mb-2">How Scoring Works</h4>
        <p className="text-sm text-gray-700">
          Aggregate Score = (Provider Count × 10) + (10 - Best Rank) + Total Mentions
        </p>
        <p className="text-xs text-blue-700 mt-2">
          For this brand: ({brand.provider_count} × 10) + (10 - {brand.best_rank}) + {brand.total_mentions} ={' '}
          {brand.aggregate_score}
        </p>
      </div>
    </div>
  );
};
