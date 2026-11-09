import type { BrandExpansionAllResult } from '../../types';
import { WarningIcon } from '../ui';
import {
  SuggestionChips, SuggestionPanel, type PendingBrandSelectionProps
} from './SuggestionPanel';

interface BrandExpansionPanelProps extends PendingBrandSelectionProps {
  readonly result: BrandExpansionAllResult;
  readonly target: 'first_party' | 'competitor';
}

/** What "Suggest sub-brands" found for one list: the parent companies, likely duplicates and the missing sub-brands. */
export const BrandExpansionPanel = ({
  result, target, pendingBrands, onToggleBrand, onAccept, onCancel,
}: BrandExpansionPanelProps) => {
  const owner = target === 'first_party' ? 'your brands' : 'your competitors';
  const parents = result.parent_companies ?? [];
  const duplicates = result.duplicates_found ?? [];

  return (
    <SuggestionPanel title={<>Sub-brands missing from {owner}</>} notes={result.notes} error={result.error} onDismiss={onCancel}>
      {parents.length > 0 && (
        <p className="mb-3 text-sm text-gray-600">Parent companies: {parents.join(', ')}</p>
      )}
      {duplicates.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-amber-700">
            <WarningIcon className="h-4 w-4" />
            Possible duplicates in your list
          </p>
          <ul className="space-y-0.5 text-sm text-gray-700">
            {duplicates.map((dup) => (
              <li key={`${dup.brand}-${dup.duplicate_of}`}>&ldquo;{dup.brand}&rdquo; may be the same as &ldquo;{dup.duplicate_of}&rdquo;</li>
            ))}
          </ul>
        </div>
      )}
      <SuggestionChips
        suggestions={result.suggestions}
        pendingBrands={pendingBrands}
        onToggleBrand={onToggleBrand}
        onAccept={onAccept}
        onCancel={onCancel}
        emptyText="No missing sub-brands found. The list looks complete."
      />
    </SuggestionPanel>
  );
};
