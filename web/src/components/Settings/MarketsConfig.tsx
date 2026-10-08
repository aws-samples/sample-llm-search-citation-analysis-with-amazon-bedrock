import { useState } from 'react';
import type { Market } from '../../types';
import type {
  MarketsController, MarketsSaveOutcome
} from '../../hooks/useMarkets';
import { useMarketSelection } from '../Markets/marketSelectionContext';
import { marketName } from '../Markets/marketSelection';
import {
  Button, PencilIcon, PlusIcon, TrashIcon
} from '../ui';
import { ErrorAlert } from '../ui/ErrorAlert';
import { ConfirmModal } from '../ui/Modal';
import {
  SkeletonLines, SkeletonRegion
} from '../ui/Skeleton';
import { MarketForm } from './MarketForm';
import { MAX_MARKETS } from './marketFormModel';
import { SettingsSectionHeader } from './SettingsSectionHeader';

interface MarketsConfigProps { readonly isAdmin: boolean; }

type Editing =
  | { readonly kind: 'new' }
  | {
    readonly kind: 'edit';
    readonly market: Market;
  }
  | null;

/** The refusal of the latest save, worded for the reader; `null` when it did not fail. */
export function saveProblem(outcome: MarketsSaveOutcome, markets: readonly Market[]): string | null {
  if (outcome.status !== 'failed') return null;
  if (outcome.inUse.length === 0) return outcome.message;
  const names = outcome.inUse.map((marketId) => marketName(marketId, markets)).join(', ');
  return `Keywords still use ${names}. Move those keywords to another market or delete them first.`;
}

function describeMarket(market: Market): string {
  const place = [market.city, market.region, `${market.country_name} (${market.country})`].filter(Boolean).join(', ');
  return `${place} · ${market.language_name} (${market.language}) · ${market.currency} · ${market.timezone}`;
}

function describeBrands(market: Market): string | null {
  const parts = [
    market.competitors?.length ? `Competitors: ${market.competitors.join(', ')}` : null,
    market.first_party_aliases?.length ? `Local brand names: ${market.first_party_aliases.join(', ')}` : null,
  ].filter((part) => part !== null);
  return parts.length === 0 ? null : parts.join(' · ');
}

interface MarketRowProps {
  readonly market: Market;
  readonly isAdmin: boolean;
  readonly busy: boolean;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
}

function MarketRow({
  market, isAdmin, busy, onEdit, onRemove
}: MarketRowProps) {
  const brands = describeBrands(market);
  return (
    <li className="flex items-start gap-3 p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900">
          {market.name} <span className="text-xs font-normal text-gray-400">{market.market_id}</span>
        </p>
        <p className="text-xs text-gray-500 mt-0.5">{describeMarket(market)}</p>
        {brands !== null && <p className="text-xs text-gray-500 mt-0.5">{brands}</p>}
      </div>
      {isAdmin && (
        <div className="flex shrink-0 gap-1">
          <Button variant="iconOnly" size="sm" onClick={onEdit} disabled={busy} aria-label={`Edit ${market.name}`}>
            <PencilIcon className="w-4 h-4" />
          </Button>
          <Button variant="iconOnly" size="sm" onClick={onRemove} disabled={busy} aria-label={`Remove ${market.name}`}>
            <TrashIcon className="w-4 h-4" />
          </Button>
        </div>
      )}
    </li>
  );
}

function MarketsEmpty({ isAdmin }: MarketsConfigProps) {
  return (
    <p className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
      No markets yet. Every keyword is asked without a country or language.
      {isAdmin ? ' Add a market to ask keywords as a local user would.' : ''}
    </p>
  );
}

interface HeaderActionsProps {
  readonly isAdmin: boolean;
  readonly catalog: MarketsController;
  readonly editing: boolean;
  readonly onAdd: () => void;
}

function HeaderActions({
  isAdmin, catalog, editing, onAdd
}: HeaderActionsProps) {
  const saving = catalog.saveOutcome.status === 'saving';
  return (
    <div className="flex gap-2">
      <Button variant="secondary" size="sm" onClick={catalog.reload} disabled={catalog.loading || saving}>Refresh</Button>
      {isAdmin && (
        <Button size="sm" leadingIcon={<PlusIcon className="w-4 h-4" />} onClick={onAdd}
          disabled={!catalog.loaded || saving || editing || catalog.markets.length >= MAX_MARKETS}>
          Add market
        </Button>
      )}
    </div>
  );
}

interface MarketListProps {
  readonly isAdmin: boolean;
  readonly catalog: MarketsController;
  readonly busy: boolean;
  readonly onEdit: (market: Market) => void;
  readonly onRemove: (market: Market) => void;
}

/** The placeholder before the first read, the empty state, or one row per market. */
function MarketList({
  isAdmin, catalog, busy, onEdit, onRemove
}: MarketListProps) {
  if (!catalog.loaded) {
    return catalog.loading ? (
      <SkeletonRegion label="Loading markets" className="space-y-3">
        <SkeletonLines lines={3} className="max-w-xl" />
      </SkeletonRegion>
    ) : null;
  }
  if (catalog.markets.length === 0) return <MarketsEmpty isAdmin={isAdmin} />;
  return (
    <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200">
      {catalog.markets.map((market) => (
        <MarketRow key={market.market_id} market={market} isAdmin={isAdmin} busy={busy}
          onEdit={() => onEdit(market)} onRemove={() => onRemove(market)} />
      ))}
    </ul>
  );
}

/** The add/edit form state and the saves of the whole list it leads to. */
function useMarketsEditor(catalog: MarketsController) {
  const {
    markets, save
  } = catalog;
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<Market | null>(null);
  const editedId = editing?.kind === 'edit' ? editing.market.market_id : null;

  const submit = async (market: Market) => {
    const next = editedId === null
      ? [...markets, market]
      : markets.map((current) => (current.market_id === editedId ? market : current));
    if (await save(next)) setEditing(null);
  };

  return {
    editing,
    setEditing,
    removing,
    setRemoving,
    others: markets.filter((market) => market.market_id !== editedId),
    submit,
    remove: (market: Market) => { void save(markets.filter((current) => current.market_id !== market.market_id)); },
  };
}

/**
 * Settings › Markets: the countries and languages keywords are asked from.
 * Administrators add, edit and remove markets (each change saves the whole
 * list); everyone else sees the list read-only.
 */
export function MarketsConfig({ isAdmin }: MarketsConfigProps) {
  const { catalog } = useMarketSelection();
  const editor = useMarketsEditor(catalog);
  const {
    editing, removing
  } = editor;
  const saving = catalog.saveOutcome.status === 'saving';

  return (
    <div className="space-y-4">
      <SettingsSectionHeader
        title="Markets"
        description="The countries and languages keywords are asked from. A keyword without a market is asked as before."
      >
        <HeaderActions isAdmin={isAdmin} catalog={catalog} editing={editing !== null} onAdd={() => editor.setEditing({ kind: 'new' })} />
      </SettingsSectionHeader>

      <ErrorAlert message={catalog.error} />
      <ErrorAlert message={saveProblem(catalog.saveOutcome, catalog.markets)} />
      {catalog.saveOutcome.status === 'saved' && <output className="block text-sm text-emerald-700">Markets saved.</output>}

      {editing !== null && (
        <MarketForm key={editing.kind === 'edit' ? editing.market.market_id : 'new'}
          market={editing.kind === 'edit' ? editing.market : null} others={editor.others} saving={saving}
          onSubmit={(market) => { void editor.submit(market); }} onCancel={() => editor.setEditing(null)} />
      )}

      <MarketList isAdmin={isAdmin} catalog={catalog} busy={saving || editing !== null}
        onEdit={(market) => editor.setEditing({
          kind: 'edit',
          market,
        })}
        onRemove={editor.setRemoving} />
      {!isAdmin && <p className="text-sm text-gray-600">Only administrators can change markets.</p>}

      <ConfirmModal
        isOpen={removing !== null}
        onClose={() => editor.setRemoving(null)}
        onConfirm={() => { if (removing !== null) editor.remove(removing); }}
        title="Remove market"
        message={`Remove "${removing?.name ?? ''}"? Markets still used by keywords cannot be removed.`}
        confirmText="Remove"
        confirmVariant="danger"
      />
    </div>
  );
}
