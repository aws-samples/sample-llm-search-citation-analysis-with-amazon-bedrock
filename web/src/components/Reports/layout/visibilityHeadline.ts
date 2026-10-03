import type { VisibilityResponse } from '../../../types';
import type { VisibilityHeadlineProps } from './reportSlices';
import {
  gateSection, type SectionGate
} from './sectionGate';

/**
 * Gates a "Headline" section on its visibility payload. Every headline opens
 * with the same title and loading copy; a scope whose keywords have no
 * answered run yet shows the report's empty-state message.
 */
export function gateVisibilityHeadline(
  {
    visibility, loading, error
  }: VisibilityHeadlineProps,
  emptyMessage: string,
): SectionGate<VisibilityResponse> {
  return gateSection({
    title: 'Headline',
    loading,
    loadingMessage: 'Loading visibility…',
    error,
    value: visibility !== null && visibility.keywords_with_data > 0 ? visibility : null,
    emptyMessage,
  });
}
