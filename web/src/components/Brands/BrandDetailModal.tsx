import {
  useState, useEffect, useId
} from 'react';
import { createPortal } from 'react-dom';
import type {
  AggregatedBrand, ProviderBrandData 
} from '../../types';
import type { BrandAppearancesRequest } from '../../api/brandMentions';
import { ProviderResponsesTab } from './ProviderResponsesTab';
import { BrandOverviewTab } from './BrandOverviewTab';
import { SelfReflectionPanel } from '../SelfReflection/SelfReflectionPanel';
import { Modal } from '../ui/Modal';
import { classificationLabel } from './brandPresentation';
import { ModalCloseFooter } from '../ui/ModalCloseFooter';
import {
  TabBar, TabPanel, type TabDefinition
} from '../ui/TabBar';
import {
  CHART_BAR_PATHS, LIGHTBULB_PATHS 
} from '../ui/iconPaths';

interface BrandDetailModalProps {
  brand: AggregatedBrand;
  /** The summary's scope and filters, for "Show all appearances". */
  appearancesRequest?: BrandAppearancesRequest | null;
  providerData: ProviderBrandData[];
  keyword: string;
  /**
   * Whether `keyword` names one keyword. For a group or "All keywords" there is
   * no single answer per engine and nothing to analyse, so only the overview shows.
   */
  singleKeyword?: boolean;
  queryPromptId?: string | null;
  onClose: () => void;
}

type ModalTab = 'overview' | 'responses' | 'ranking-analysis';

const CHAT_BUBBLE_PATHS = ['M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z'];

/** The three tabs; the responses tab counts the providers that answered. */
const modalTabs = (providerCount: number): ReadonlyArray<TabDefinition<ModalTab>> => [
  {
    id: 'overview',
    label: 'Overview',
    iconPaths: CHART_BAR_PATHS,
  },
  {
    id: 'responses',
    label: `AI Responses (${providerCount})`,
    iconPaths: CHAT_BUBBLE_PATHS,
  },
  {
    id: 'ranking-analysis',
    label: 'Ranking Analysis',
    iconPaths: LIGHTBULB_PATHS,
  },
];

export const BrandDetailModal = ({
  brand,
  appearancesRequest = null,
  providerData,
  keyword,
  singleKeyword = true,
  queryPromptId,
  onClose,
}: BrandDetailModalProps) => {
  const [activeTab, setActiveTab] = useState<ModalTab>('overview');
  const [mounted, setMounted] = useState(false);
  const panelId = useId();
  const titleId = useId();

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  const getClassificationStyle = (classification: string) => {
    switch (classification) {
      case 'first_party':
        return 'bg-violet-100 text-violet-700';
      case 'competitor':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  const modalContent = (
    <Modal isOpen onClose={onClose} size="6xl" layout="flush" labelledBy={titleId}>
      {/* Header; `pr-12` keeps the text clear of the dialog's close button. */}
      <div className="pl-4 sm:pl-6 pr-12 py-4 border-b border-gray-200">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h2 id={titleId} className="text-lg sm:text-xl font-semibold text-gray-900 break-words min-w-0">{brand.name}</h2>
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium ${getClassificationStyle(
                brand.classification
              )}`}
            >
              {classificationLabel(brand.classification)}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">
            {singleKeyword ? 'Keyword' : 'Scope'}: <span className="font-medium text-gray-700 break-words">{keyword}</span> • Rank #
            {brand.overall_rank} • Score: {brand.aggregate_score}
          </p>
          {brand.parent_company && (
            <p className="text-xs sm:text-sm text-gray-500 mt-1">Parent: {brand.parent_company}</p>
          )}
        </div>
      </div>

      {singleKeyword ? (
        <>
          <TabBar
            tabs={modalTabs(providerData.length)}
            activeId={activeTab}
            onChange={setActiveTab}
            label={`${brand.name} details`}
            panelId={panelId}
            className="px-4 sm:px-6"
          />

          <TabPanel id={panelId} activeId={activeTab} className="flex-1 overflow-y-auto p-4 sm:p-6">
            {activeTab === 'overview' && (
              <BrandOverviewTab brand={brand} appearancesRequest={appearancesRequest} />
            )}
            {activeTab === 'responses' && (
              <ProviderResponsesTab brand={brand} providerData={providerData} />
            )}
            {activeTab === 'ranking-analysis' && (
              <SelfReflectionPanel
                keyword={keyword}
                brand={brand.name}
                queryPromptId={queryPromptId ?? ''}
              />
            )}
          </TabPanel>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          <p className="text-sm text-gray-500">
            To read each AI engine&apos;s answer and analyse this ranking, pick one keyword as the scope.
          </p>
          <BrandOverviewTab brand={brand} appearancesRequest={appearancesRequest} />
        </div>
      )}

      {/* Footer */}
      <ModalCloseFooter onClose={onClose} paddingClassName="px-4 sm:px-6" />
    </Modal>
  );

  if (!mounted) return null;
  
  return createPortal(modalContent, document.body);
};
