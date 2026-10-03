import {
  useState, useEffect 
} from 'react';
import { createPortal } from 'react-dom';
import type {
  AggregatedBrand, ProviderBrandData 
} from '../../types';
import { ProviderResponsesTab } from './ProviderResponsesTab';
import { BrandOverviewTab } from './BrandOverviewTab';
import { SelfReflectionPanel } from '../SelfReflection/SelfReflectionPanel';
import { CloseIcon } from '../ui';
import { classificationLabel } from './brandPresentation';
import { ModalCloseFooter } from '../ui/ModalCloseFooter';
import { StrokeIcon } from '../ui/StrokeIcon';
import {
  CHART_BAR_PATHS, LIGHTBULB_PATHS 
} from '../ui/iconPaths';

interface BrandDetailModalProps {
  brand: AggregatedBrand;
  providerData: ProviderBrandData[];
  keyword: string;
  queryPromptId?: string | null;
  onClose: () => void;
}

type ModalTab = 'overview' | 'responses' | 'ranking-analysis';

export const BrandDetailModal = ({
  brand,
  providerData,
  keyword,
  queryPromptId,
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
                {classificationLabel(brand.classification)}
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
            <CloseIcon />
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
              <StrokeIcon className="w-4 h-4" paths={CHART_BAR_PATHS} />
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
              <StrokeIcon className="w-4 h-4" paths={['M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z']} />
              AI Responses ({providerData.length})
            </button>
            <button
              onClick={() => setActiveTab('ranking-analysis')}
              className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'ranking-analysis'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <StrokeIcon className="w-4 h-4" paths={LIGHTBULB_PATHS} />
              Ranking Analysis
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
          {activeTab === 'ranking-analysis' && (
            <SelfReflectionPanel
              keyword={keyword}
              brand={brand.name}
              queryPromptId={queryPromptId ?? ''}
            />
          )}
        </div>

        {/* Footer */}
        <ModalCloseFooter onClose={onClose} paddingClassName="px-4 sm:px-6" />
      </div>
    </div>
  );

  if (!mounted) return null;
  
  return createPortal(modalContent, document.body);
};
