import { useState } from 'react';
import type {
  AggregatedBrand, BrandConfig 
} from '../../types';

interface BrandMentionsTableProps {
  brands: AggregatedBrand[];
  keyword: string;
  onBrandClick: (brand: AggregatedBrand) => void;
  config?: BrandConfig | null;
}

export const BrandMentionsTable = ({
  brands, keyword, onBrandClick, config 
}: BrandMentionsTableProps) => {
  const [sortBy, setSortBy] = useState<'rank' | 'score' | 'providers'>('rank');

  const sortedBrands = [...(brands ?? [])].sort((a, b) => {
    switch (sortBy) {
      case 'rank':
        return a.overall_rank - b.overall_rank;
      case 'score':
        return b.aggregate_score - a.aggregate_score;
      case 'providers':
        return b.provider_count - a.provider_count;
      default:
        return 0;
    }
  });

  const getRankColor = (rank: number) => {
    if (rank <= 3) return 'text-green-600 bg-green-50';
    if (rank <= 7) return 'text-blue-600 bg-blue-50';
    return 'text-gray-600 bg-gray-50';
  };

  const getClassificationBadge = (classification: string) => {
    switch (classification) {
      case 'first_party':
        return <span className="px-2 py-1 bg-emerald-100 text-emerald-800 rounded text-xs font-medium">First Party</span>;
      case 'competitor':
        return <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs font-medium">Competitor</span>;
      default:
        return <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-medium">Other</span>;
    }
  };

  const industryName = config?.industry 
    ? config.industry.charAt(0).toUpperCase() + config.industry.slice(1)
    : 'Brand';

  return (
    <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900">{industryName} Mentions</h2>
          <p className="text-xs sm:text-sm text-gray-600 mt-1">
            Keyword: <span className="font-semibold">{keyword}</span> • {brands.length} brands found
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSortBy('rank')}
            className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
              sortBy === 'rank' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            By Rank
          </button>
          <button
            onClick={() => setSortBy('score')}
            className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
              sortBy === 'score' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            By Score
          </button>
          <button
            onClick={() => setSortBy('providers')}
            className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
              sortBy === 'providers' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            By Providers
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Rank
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Brand Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Classification
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                Providers
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                Mentions
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                Best Rank
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                Score
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sortedBrands.map((brand) => {
              const getRowBgClass = (classification: string | undefined) => {
                if (classification === 'first_party') return 'bg-green-50/30';
                if (classification === 'competitor') return 'bg-red-50/30';
                return '';
              };
              return (
                <tr
                  key={brand.name}
                  className={`hover:bg-gray-50 cursor-pointer transition-colors ${getRowBgClass(brand.classification)}`}
                  onClick={() => onBrandClick(brand)}
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center justify-center w-8 h-8 rounded-full font-bold ${getRankColor(
                        brand.overall_rank
                      )}`}
                    >
                      {brand.overall_rank}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-gray-900">{brand.name}</div>
                    {brand.parent_company && (
                      <div className="text-xs text-gray-500">{brand.parent_company}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getClassificationBadge(brand.classification)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <div className="flex justify-center gap-1 flex-wrap">
                      {brand.providers.slice(0, 4).map((provider) => (
                        <span
                          key={provider}
                          className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs"
                          title={provider}
                        >
                          {provider.slice(0, 3).toUpperCase()}
                        </span>
                      ))}
                      {brand.providers.length > 4 && (
                        <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs">
                          +{brand.providers.length - 4}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">{brand.provider_count} AI(s)</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <span className="text-sm font-medium text-gray-900">{brand.total_mentions}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <span className="text-sm font-medium text-gray-900">#{brand.best_rank}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <span className="text-sm font-bold text-blue-600">{brand.aggregate_score}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onBrandClick(brand);
                      }}
                      className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                    >
                      View Details →
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {brands.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">No brand mentions found for this keyword</p>
          <p className="text-sm mt-2">Try running an analysis first</p>
        </div>
      )}
    </div>
  );
};
