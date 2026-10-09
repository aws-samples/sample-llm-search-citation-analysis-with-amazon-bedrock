import { useMarketCitations } from '../../hooks/useMarketCitations';
import type { TopUrl } from '../../types';
import { ErrorAlert } from '../ui/ErrorAlert';
import { CitationsView } from './CitationsView';

interface MarketCitationsViewProps {
  /** Every market's citations, from the dashboard load. */
  readonly citations: TopUrl[];
  readonly onNavigateToRawResponses?: (path: string) => void;
}

/** The Citations tab narrowed to the header's market (every market combined by default). */
export function MarketCitationsView({
  citations, onNavigateToRawResponses
}: MarketCitationsViewProps) {
  const view = useMarketCitations(citations);
  return (
    <div aria-busy={view.loading}>
      <ErrorAlert message={view.error} />
      <CitationsView citations={view.citations} onNavigateToRawResponses={onNavigateToRawResponses} />
    </div>
  );
}
