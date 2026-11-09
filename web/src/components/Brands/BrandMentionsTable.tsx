import {
  useState, type ReactNode
} from 'react';
import type { AggregatedBrand } from '../../types';
import { ArrowRightIcon } from '../ui';
import { providerName } from '../../constants/providers';
import { BRAND_TYPE_BADGE } from '../../constants/brandTypeBadge';

type SortKey = 'rank' | 'score' | 'providers';

const SORT_OPTIONS: ReadonlyArray<readonly [SortKey, string]> = [
  ['rank', 'By Rank'],
  ['score', 'By Score'],
  ['providers', 'By Providers'],
];

interface BrandMentionsTableProps {
  /** The brands loaded so far, best aggregate score first. */
  brands: readonly AggregatedBrand[];
  /** Brands of the scope and filter over every page; defaults to the loaded count. */
  totalBrands?: number;
  /** More pages of brands load as the reader scrolls. */
  moreToLoad?: boolean;
  /** Below the table: the load-on-scroll footer. */
  footer?: ReactNode;
  keyword: string;
  /** Whether `keyword` names one keyword; otherwise it is a group or "All keywords". */
  singleKeyword?: boolean;
  onBrandClick: (brand: AggregatedBrand) => void;
}

/**
 * "Showing 100 of 1,037 brands". The rank order is the API's (aggregate
 * score), so it holds for brands not loaded yet; sorting by providers only
 * reorders the loaded brands, and the line says so while more remain.
 */
function shownSummary(shown: number, total: number, moreToLoad: boolean, sortBy: SortKey): string {
  const noun = total === 1 ? 'brand' : 'brands';
  const count = shown < total ? `Showing ${shown.toLocaleString()} of ${total.toLocaleString()} ${noun}` : `${total.toLocaleString()} ${noun} found`;
  if (!moreToLoad) return count;
  return sortBy === 'providers' ? `${count} · sorted among the loaded brands; scroll for more` : `${count} · more load as you scroll`;
}

export const BrandMentionsTable = ({
  brands, totalBrands, moreToLoad = false, footer, keyword, singleKeyword = true, onBrandClick
}: BrandMentionsTableProps) => {
  const [sortBy, setSortBy] = useState<SortKey>('rank');

  const sortedBrands = [...brands].sort((a, b) => {
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
    if (rank <= 3) return 'text-emerald-700 bg-gray-50';
    if (rank <= 7) return 'text-blue-700 bg-blue-50';
    return 'text-gray-600 bg-gray-50';
  };

  const getClassificationBadge = (classification: string) => {
    switch (classification) {
      case 'first_party':
        return <span className={`px-2 py-1 rounded-sm text-xs font-medium ${BRAND_TYPE_BADGE.first_party}`}>First Party</span>;
      case 'competitor':
        return <span className={`px-2 py-1 rounded-sm text-xs font-medium ${BRAND_TYPE_BADGE.competitor}`}>Competitor</span>;
      default:
        return <span className={`px-2 py-1 rounded-sm text-xs font-medium ${BRAND_TYPE_BADGE.other}`}>Other</span>;
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Brands mentioned</h2>
          <p className="text-xs sm:text-sm text-gray-600 mt-1">
            {singleKeyword ? 'Keyword' : 'Scope'}: <span className="font-semibold break-words">{keyword}</span> • {shownSummary(brands.length, totalBrands ?? brands.length, moreToLoad, sortBy)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {SORT_OPTIONS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={sortBy === value}
              onClick={() => setSortBy(value)}
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 ${
                sortBy === value ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
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
                if (classification === 'first_party') return 'bg-gray-50/30';
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
                    <div className="text-sm font-medium text-gray-900 break-words">{brand.name}</div>
                    {brand.parent_company && (
                      <div className="text-xs text-gray-500">{brand.parent_company}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getClassificationBadge(brand.classification)}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <div className="flex justify-center gap-1 flex-wrap max-w-56 mx-auto">
                      {brand.providers.slice(0, 4).map((provider) => (
                        <span
                          key={provider}
                          className="px-2 py-1 bg-blue-100 text-blue-800 rounded-sm text-xs whitespace-nowrap"
                        >
                          {providerName(provider)}
                        </span>
                      ))}
                      {brand.providers.length > 4 && (
                        <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded-sm text-xs">
                          +{brand.providers.length - 4}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">{brand.provider_count} {brand.provider_count === 1 ? 'AI engine' : 'AI engines'}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <span className="text-sm font-medium text-gray-900">{brand.total_mentions}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <span className="text-sm font-medium text-gray-900">#{brand.best_rank}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <span className="text-sm font-bold text-blue-700">{brand.aggregate_score}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onBrandClick(brand);
                      }}
                      className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-800 text-sm font-medium rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-900"
                    >
                      View Details
                      <ArrowRightIcon className="w-4 h-4" />
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
          <p className="text-lg">No brand mentions found in this scope</p>
          <p className="text-sm mt-2">Run an analysis for these keywords, or pick another scope or filter.</p>
        </div>
      )}
      {footer}
    </div>
  );
};
