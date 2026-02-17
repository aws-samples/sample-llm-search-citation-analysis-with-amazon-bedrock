import { useState } from 'react';
import { useBrandMentions } from '../../hooks/useBrandMentions';
import { useBrandConfig } from '../../hooks/useBrandConfig';
import { BrandMentionsTable } from './BrandMentionsTable';
import { BrandDetailModal } from './BrandDetailModal';
import { BrandConfigPanel } from './BrandConfigPanel';
import { Spinner } from '../ui/Spinner';
import type {
  Keyword, AggregatedBrand, BrandMentionsResponse, BrandConfig 
} from '../../types';

interface BrandsViewProps {keywords: Keyword[];}

const KeywordSelector = ({
  keywords, selectedKeyword, onSelect 
}: {
  keywords: Keyword[];
  selectedKeyword: string | null;
  onSelect: (keyword: string) => void;
}) => (
  <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
    <h3 className="text-sm font-medium text-gray-900 mb-4">Select a Keyword</h3>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {keywords.map((kw) => (
        <button
          key={kw.id}
          onClick={() => onSelect(kw.keyword)}
          className={`p-4 rounded-lg border text-left transition-all ${
            selectedKeyword === kw.keyword
              ? 'border-gray-900 bg-gray-50'
              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
          }`}
        >
          <div className="font-medium text-sm text-gray-900">{kw.keyword}</div>
          <div className="text-xs text-gray-400 mt-1">{new Date(kw.created_at).toLocaleDateString()}</div>
        </button>
      ))}
    </div>
    {keywords.length === 0 && (
      <p className="text-gray-400 text-center py-8 text-sm">No keywords available.</p>
    )}
  </div>
);

const FilterButton = ({
  active, onClick, activeClass, inactiveClass, children 
}: {
  active: boolean;
  onClick: () => void;
  activeClass: string;
  inactiveClass: string;
  children: React.ReactNode;
}) => (
  <button
    onClick={onClick}
    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${active ? activeClass : inactiveClass}`}
  >
    {children}
  </button>
);

const ClassificationFilter = ({
  filter, onFilterChange, counts 
}: {
  filter: string | null;
  onFilterChange: (filter: string | null) => void;
  counts: {
    total: number;
    firstParty: number;
    competitor: number;
    other: number 
  };
}) => (
  <div className="flex gap-2 flex-wrap">
    <FilterButton active={filter === null} onClick={() => onFilterChange(null)} activeClass="bg-gray-900 text-white" inactiveClass="bg-gray-100 text-gray-700 hover:bg-gray-200">
      All ({counts.total})
    </FilterButton>
    <FilterButton active={filter === 'first_party'} onClick={() => onFilterChange('first_party')} activeClass="bg-emerald-600 text-white" inactiveClass="bg-emerald-50 text-emerald-700 hover:bg-emerald-100">
      First Party ({counts.firstParty})
    </FilterButton>
    <FilterButton active={filter === 'competitor'} onClick={() => onFilterChange('competitor')} activeClass="bg-red-600 text-white" inactiveClass="bg-red-50 text-red-700 hover:bg-red-100">
      Competitors ({counts.competitor})
    </FilterButton>
    <FilterButton active={filter === 'other'} onClick={() => onFilterChange('other')} activeClass="bg-gray-600 text-white" inactiveClass="bg-gray-100 text-gray-700 hover:bg-gray-200">
      Other ({counts.other})
    </FilterButton>
  </div>
);

const EmptyState = () => (
  <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
    <p className="text-sm text-gray-500">Select a keyword above to view brand mentions</p>
  </div>
);

const LoadingState = () => (
  <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
    <Spinner className="mx-auto mb-3 text-gray-400" />
    <p className="text-sm text-gray-500">Loading brand mentions...</p>
  </div>
);

const Header = ({
  industryName, firstPartyCount, competitorCount, onConfigClick 
}: {
  industryName: string;
  firstPartyCount: number;
  competitorCount: number;
  onConfigClick: () => void;
}) => (
  <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
    <div className="flex flex-col gap-4">
      <div className="flex-1">
        <h2 className="text-lg sm:text-xl font-semibold text-gray-900">Brand Mentions</h2>
        <p className="text-sm text-gray-500 mt-2">See which brands AI search engines mention.</p>
      </div>
      <button onClick={onConfigClick} className="px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 self-start">
        Configure Brands
      </button>
    </div>
    <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-2 text-sm">
      <span className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg">{industryName}</span>
      {firstPartyCount > 0 && <span className="px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg">{firstPartyCount} first-party</span>}
      {competitorCount > 0 && <span className="px-3 py-1.5 bg-red-50 text-red-700 rounded-lg">{competitorCount} competitors</span>}
    </div>
  </div>
);

const getFilterCounts = (data: BrandMentionsResponse | null) => ({
  total: data?.aggregated.total_unique_brands ?? 0,
  firstParty: data?.aggregated.summary.first_party_count ?? 0,
  competitor: data?.aggregated.summary.competitor_count ?? 0,
  other: data?.aggregated.summary.other_count ?? 0,
});

const BrandContent = ({
  data, loading, error, selectedKeyword, classificationFilter, onFilterChange, onBrandClick, config 
}: {
  data: BrandMentionsResponse | null;
  loading: boolean;
  error: string | null;
  selectedKeyword: string | null;
  classificationFilter: string | null;
  onFilterChange: (filter: string | null) => void;
  onBrandClick: (brand: AggregatedBrand) => void;
  config: BrandConfig | null;
}) => {
  if (loading) return <LoadingState />;
  if (error) return <div className="bg-red-50 border border-red-200 rounded-lg p-4"><p className="text-sm text-red-700">{error}</p></div>;
  if (selectedKeyword === null) return <EmptyState />;
  if (!data) return null;

  const counts = getFilterCounts(data);

  return (
    <>
      <ClassificationFilter
        filter={classificationFilter}
        onFilterChange={onFilterChange}
        counts={counts}
      />
      <BrandMentionsTable brands={data.aggregated.brands} keyword={data.keyword} onBrandClick={onBrandClick} config={config} />
    </>
  );
};

const useViewState = () => {
  const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<AggregatedBrand | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [classificationFilter, setClassificationFilter] = useState<string | null>(null);
  
  return {
    selectedKeyword,
    setSelectedKeyword,
    selectedBrand,
    setSelectedBrand,
    showConfig,
    setShowConfig,
    classificationFilter,
    setClassificationFilter
  };
};

const renderModals = (props: {
  selectedBrand: AggregatedBrand | null;
  data: BrandMentionsResponse | null;
  setSelectedBrand: (brand: AggregatedBrand | null) => void;
  showConfig: boolean;
  config: BrandConfig | null;
  presets: ReturnType<typeof useBrandConfig>['presets'];
  configLoading: boolean;
  saveConfig: ReturnType<typeof useBrandConfig>['saveConfig'];
  setShowConfig: (show: boolean) => void;
  expandAllBrands: ReturnType<typeof useBrandConfig>['expandAllBrands'];
  findCompetitors: ReturnType<typeof useBrandConfig>['findCompetitors'];
}) => (
  <>
    {props.selectedBrand && props.data && (
      <BrandDetailModal 
        brand={props.selectedBrand} 
        providerData={props.data.by_provider} 
        keyword={props.data.keyword} 
        onClose={() => props.setSelectedBrand(null)} 
      />
    )}
    {props.showConfig && (
      <BrandConfigPanel 
        config={props.config} 
        presets={props.presets} 
        loading={props.configLoading} 
        onSave={props.saveConfig} 
        onClose={() => props.setShowConfig(false)} 
        onExpandAllBrands={props.expandAllBrands} 
        onFindCompetitors={props.findCompetitors} 
      />
    )}
  </>
);

export const BrandsView = ({ keywords }: BrandsViewProps) => {
  const {
    selectedKeyword, setSelectedKeyword, selectedBrand, setSelectedBrand,
    showConfig, setShowConfig, classificationFilter, setClassificationFilter
  } = useViewState();

  const {
    data, loading, error 
  } = useBrandMentions(selectedKeyword, classificationFilter);
  const {
    config, presets, loading: configLoading, saveConfig, expandAllBrands, findCompetitors 
  } = useBrandConfig();

  const industryName = config?.industry ? presets?.[config.industry]?.name ?? config.industry : 'Not configured';

  return (
    <div className="space-y-6">
      <Header
        industryName={industryName}
        firstPartyCount={config?.tracked_brands?.first_party?.length ?? 0}
        competitorCount={config?.tracked_brands?.competitors?.length ?? 0}
        onConfigClick={() => setShowConfig(true)}
      />
      <KeywordSelector keywords={keywords} selectedKeyword={selectedKeyword} onSelect={setSelectedKeyword} />
      <BrandContent
        data={data}
        loading={loading}
        error={error}
        selectedKeyword={selectedKeyword}
        classificationFilter={classificationFilter}
        onFilterChange={setClassificationFilter}
        onBrandClick={setSelectedBrand}
        config={config}
      />
      {renderModals({
        selectedBrand,
        data,
        setSelectedBrand,
        showConfig,
        config,
        presets,
        configLoading,
        saveConfig,
        setShowConfig,
        expandAllBrands,
        findCompetitors
      })}
    </div>
  );
};
