import { useId } from 'react';
import type {
  BrandConfig, IndustryPresets, BrandExpansionAllResult, CompetitorDiscoveryResult 
} from '../../types';
import { BrandConfigContent } from './BrandConfigContent';
import { Modal } from '../ui/Modal';

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
  const titleId = useId();
  return (
    <Modal isOpen onClose={onClose} size="5xl" layout="flush" labelledBy={titleId}>
      {/* Header; `pr-12` keeps the text clear of the dialog's close button. */}
      <div className="pl-6 pr-12 py-4 border-b border-gray-200">
        <h2 id={titleId} className="text-xl font-semibold text-gray-900">Brand tracking</h2>
      </div>

      {/* Content. The form's save bar sticks to the bottom of this scrolling body; the bottom padding sits on
          an inner box because a sticky child of a padded scroller stops short of its bottom edge. */}
      <div className="flex-1 overflow-y-auto px-6 pt-6">
        <div className="pb-6">
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
    </Modal>
  );
};
