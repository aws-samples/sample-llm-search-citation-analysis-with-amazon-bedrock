import {
  useState, useEffect 
} from 'react';
import { createPortal } from 'react-dom';
import type {
  AggregatedBrand, ProviderBrandData 
} from '../../types';
import { ProviderResponsesTab } from './ProviderResponsesTab';
import { BrandOverviewTab } from './BrandOverviewTab';

interface BrandDetailModalProps {
  brand: AggregatedBrand;
  providerData: ProviderBrandData[];
  keyword: string;
  onClose: () => void;
}

type ModalTab = 'overview' | 'responses';

export const BrandDetailModal = ({
  brand,
  providerData,
  keyword,
  onClose,
}: BrandDetailModalProps) => {
  const [activeTab, setActiveTab] = useState<ModalTab>('overview');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  const getClassificationStyle = (classification: string) => {
    switch (classification) {
      case 'first_party':
        return 'bg-emerald-100 text-emerald-700';
      case 'competitor':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-600';
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

  const modalContent = (
    <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg border border-gray-200 max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-gray-200 flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <h2 className="text-lg sm:text-xl font-semibold text-gray-900">{brand.name}</h2>
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-medium ${getClassificationStyle(
                  brand.classification
                )}`}
              >
                {getClassificationLabel(brand.classification)}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">
              Keyword: <span className="font-medium text-gray-700">{keyword}</span> • Rank #
              {brand.overall_rank} • Score: {brand.aggregate_score}
            </p>
            {brand.parent_company && (
              <p className="text-xs sm:text-sm text-gray-400 mt-1">Parent: {brand.parent_company}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors self-end sm:self-start"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 px-4 sm:px-6">
          <nav className="-mb-px flex space-x-4 sm:space-x-8" style={{ minWidth: '280px' }}>
            <button
              onClick={() => setActiveTab('overview')}
              className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'overview'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              Overview
            </button>
            <button
              onClick={() => setActiveTab('responses')}
              className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'responses'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
              AI Responses ({providerData.length})
            </button>
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {activeTab === 'overview' && (
            <BrandOverviewTab brand={brand} providerData={providerData} />
          )}
          {activeTab === 'responses' && (
            <ProviderResponsesTab brand={brand} providerData={providerData} keyword={keyword} />
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-4 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;
  
  return createPortal(modalContent, document.body);
};
