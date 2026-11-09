/** Layout pieces the local SEO tabs share: a titled card, a search form, a results table and a request outcome. */
import type {
  SubmitEvent, ReactNode
} from 'react';
import { Button } from '../../ui/Button';
import {
  SeoRequestStatus, type SeoRequestStatusProps
} from '../SeoRequestStatus';

interface LocalCardProps {
  readonly title: string;
  /** Shown on the right of the title, e.g. how many searches a form starts. */
  readonly note?: ReactNode;
  /** Whether the answer in the card came from the cache: "From cache" shows on the right of the title. */
  readonly cached?: boolean;
  /** Buttons on the far right of the title row, e.g. the table's export. */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}

export function LocalCard({
  title, note, cached = false, actions, children
}: LocalCardProps) {
  const shownNote = note ?? (cached ? 'From cache' : undefined);
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-4 space-y-3" aria-label={title}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        <div className="flex flex-wrap items-center gap-3">
          {shownNote !== undefined && <p className="text-xs text-gray-500">{shownNote}</p>}
          {actions}
        </div>
      </div>
      {children}
    </section>
  );
}

interface LocalFormProps extends Omit<LocalCardProps, 'cached' | 'actions'> {
  readonly submitLabel: string;
  readonly canSubmit: boolean;
  readonly onSubmit: () => void;
  /** Below the form, inside the card. */
  readonly footer?: ReactNode;
}

/** A card holding a four-column form whose submit button pays for one request. */
export function LocalForm({
  title, note, submitLabel, canSubmit, onSubmit, footer, children
}: LocalFormProps) {
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <LocalCard title={title} note={note}>
      <form className="grid gap-3 sm:grid-cols-4" onSubmit={submit}>
        {children}
        <div className="flex items-end">
          <Button type="submit" disabled={!canSubmit}>{submitLabel}</Button>
        </div>
      </form>
      {footer}
    </LocalCard>
  );
}

/** A horizontally scrolling table with the given column headers (an empty header is visually hidden). */
export function LocalTable({
  headers, children
}: {
  readonly headers: readonly string[];
  readonly children: ReactNode 
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>{headers.map((header) => <th key={header} className="px-3 py-2">{header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">{children}</tbody>
      </table>
    </div>
  );
}

/** A framed table-shaped placeholder of tall rows while loading, the error, or the answer rendered by `children`. */
export function RequestOutcome<TResponse>(
  props: Pick<SeoRequestStatusProps<TResponse>, 'state' | 'loadingLabel' | 'columns' | 'children'>
) {
  return <SeoRequestStatus {...props} rows={6} rowClassName="h-10" className="bg-white rounded-lg border border-gray-200" />;
}
