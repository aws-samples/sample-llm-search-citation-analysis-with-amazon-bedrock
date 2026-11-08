import {
  SeoRequestStatus, type SeoRequestStatusProps
} from '../SeoRequestStatus';

/** The skeleton, error or answer of a Domain Overview table: the skeleton rows sit in the table card they will fill. */
export function DomainTableStatus<TResponse>(props: Omit<SeoRequestStatusProps<TResponse>, 'rowClassName' | 'className'>) {
  return <SeoRequestStatus {...props} rowClassName="h-11" className="rounded-lg border border-gray-200 bg-white" />;
}
