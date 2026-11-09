import type { DomainExpansion } from '../../../hooks/useBacklinksDomainExpansion';
import type {
  BacklinksTab, BacklinksTableRows, SortOrder
} from '../../../types/api/seoBacklinks';
import {
  DATA_TABLE_CELL, DataTable, alignClass
} from '../../ui/DataTable';
import { ChevronDownIcon } from '../../ui/Icons';
import {
  TABLE_COLUMNS, withRowKeys, type BacklinksColumn
} from './backlinksColumns';
import { TAB_LABELS } from './backlinksFormat';

export interface TableSort {
  readonly field: string;
  readonly order: SortOrder;
}

function ExpansionRows({
  domain, expansion, span
}: {
  readonly domain: string;
  readonly expansion: DomainExpansion;
  readonly span: number;
}) {
  const links = expansion.expanded.get(domain);
  if (links === undefined) return null;
  const status = (text: string) => (
    <tr className="bg-gray-50"><td colSpan={span} className={`${DATA_TABLE_CELL} pl-14 text-gray-500`}>{text}</td></tr>
  );
  if (links.status === 'loading') return status('Loading links…');
  if (links.status === 'error') return status("Couldn't load this domain's links.");
  const others = links.rows;
  if (others.length === 0) return status('No other links from this domain.');
  return (
    <>
      {withRowKeys('backlinks', others).map(({
        row, key
      }) => (
        <tr key={key} className="bg-gray-50">
          <td className={DATA_TABLE_CELL} />
          {TABLE_COLUMNS.backlinks.map((column) => (
            <td key={column.id} className={`${DATA_TABLE_CELL} ${alignClass(column)} ${column.id === 'source' ? 'pl-8' : ''}`}>
              {column.render(row)}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function ExpandButton({
  domain, expansion
}: {
  readonly domain: string | null;
  readonly expansion: DomainExpansion;
}) {
  if (domain === null) return null;
  const open = expansion.expanded.has(domain);
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Show'} all links from ${domain}`}
      onClick={() => expansion.toggle(domain)}
      className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
    >
      <ChevronDownIcon className={`w-4 h-4 transition-transform ${open ? '' : '-rotate-90'}`} />
    </button>
  );
}

interface BacklinksTableProps<TTab extends BacklinksTab> {
  readonly tab: TTab;
  readonly rows: ReadonlyArray<BacklinksTableRows[TTab]>;
  readonly sort: TableSort;
  readonly onSort: (field: string) => void;
  /** Backlinks in the one-per-domain view: each source domain can be expanded to all its links. */
  readonly expansion?: DomainExpansion;
}

/** The linking domain of a backlink row; `null` for the other tables' rows. */
function sourceDomain(row: BacklinksTableRows[BacklinksTab]): string | null {
  return 'domain_from' in row ? row.domain_from : null;
}

/** One page of one table, with server-side sort headers. */
export function BacklinksTable<TTab extends BacklinksTab>({
  tab, rows, sort, onSort, expansion
}: BacklinksTableProps<TTab>) {
  const columns: ReadonlyArray<BacklinksColumn<BacklinksTableRows[TTab]>> = TABLE_COLUMNS[tab];
  const keys = withRowKeys(tab, rows).map(({ key }) => key);
  const expandable = expansion !== undefined && tab === 'backlinks';
  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(_row, index) => keys[index]}
      caption={TAB_LABELS[tab]}
      sort={{
        key: sort.field,
        order: sort.order,
      }}
      onSort={onSort}
      leading={expandable ? {
        label: 'Expand',
        render: (row) => <ExpandButton domain={sourceDomain(row)} expansion={expansion} />,
      } : undefined}
      renderAfter={expandable ? (row) => {
        const domain = sourceDomain(row);
        return domain === null ? null : <ExpansionRows domain={domain} expansion={expansion} span={columns.length + 1} />;
      } : undefined}
    />
  );
}
