import type { CompetitorDiscoveryResult } from '../../types';
import {
  SuggestionChips, SuggestionPanel, type PendingBrandSelectionProps
} from './SuggestionPanel';

interface CompetitorDiscoveryPanelProps extends PendingBrandSelectionProps {
  readonly result: CompetitorDiscoveryResult;
  readonly existingCompetitors: string[];
  readonly brandExists: (brand: string, list: string[]) => boolean;
}

/** What "Find competitors" suggested: rivals of your brands to pick from; ones already tracked are shown ticked. */
export const CompetitorDiscoveryPanel = ({
  result, existingCompetitors, pendingBrands, brandExists, onToggleBrand, onAccept, onCancel,
}: CompetitorDiscoveryPanelProps) => (
  <SuggestionPanel title="Suggested competitors" notes={result.notes} error={result.error} onDismiss={onCancel}>
    <SuggestionChips
      suggestions={result.competitors}
      pendingBrands={pendingBrands}
      isAdded={(brand) => brandExists(brand, existingCompetitors)}
      onToggleBrand={onToggleBrand}
      onAccept={onAccept}
      onCancel={onCancel}
      emptyText="No new competitors found."
    />
  </SuggestionPanel>
);
