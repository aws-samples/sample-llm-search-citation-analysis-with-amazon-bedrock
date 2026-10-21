import type { TopUrl } from '../../types';
import { CitationsView } from './CitationsView';

interface MarketCitationsViewProps {
  /** The dashboard load's first page (every market combined), shown until the table's own page arrives. */
  readonly citations?: TopUrl[];
  readonly onNavigateToRawResponses?: (path: string) => void;
}

/**
 * The Citations tab narrowed to the header's market (every market combined
 * by default): the table asks the API for each page it shows.
 */
export function MarketCitationsView({
  citations, onNavigateToRawResponses
}: MarketCitationsViewProps) {
  return <CitationsView placeholder={citations} onNavigateToRawResponses={onNavigateToRawResponses} />;
}
