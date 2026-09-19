import type {
  BrandConfig, IndustryPresets, BrandExpansionAllResult, CompetitorDiscoveryResult 
} from '../../types';
import { BrandConfigContent } from './BrandConfigContent';
import { CloseIcon } from '../ui';

interface BrandConfigPanelProps {
  config: BrandConfig | null;
  presets: IndustryPresets | null;
  loading: boolean;
  onSave: (config: Partial<BrandConfig>) => Promise<void>;
  onClose: () => void;
  onExpandAllBrands?: (existingBrands: string[], brandType: 'first_party' | 'competitor') => Promise<BrandExpansionAllResult>;
  onFindCompetitors?: (firstPartyBrands: string[]) => Promise<CompetitorDiscoveryResult>;
}

export const BrandConfigPanel = ({
  config,
  presets,
  loading,
  onSave,
  onClose,
  onExpandAllBrands,
  onFindCompetitors,
}: BrandConfigPanelProps) => {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 !mt-0">
      <div className="bg-white rounded-lg border border-gray-200 max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Brand Tracking Configuration</h2>
            <p className="text-sm text-gray-500 mt-1">
              Configure extraction settings and customize prompts per industry
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <BrandConfigContent
            config={config}
            presets={presets}
            loading={loading}
            onSave={onSave}
            onExpandAllBrands={onExpandAllBrands}
            onFindCompetitors={onFindCompetitors}
            onSaveComplete={onClose}
          />
        </div>
      </div>
    </div>
  );
};
