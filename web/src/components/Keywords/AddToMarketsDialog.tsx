import { useId } from 'react';
import type {
  Keyword, Market
} from '../../types';
import { marketName } from '../Markets/marketSelection';
import { Button } from '../ui';
import { ErrorAlert } from '../ui/ErrorAlert';
import { Modal } from '../ui/Modal';
import { marketsAvailableFor } from './keywordMarkets';
import {
  useAddToMarkets, type AddToMarketsState
} from './useAddToMarkets';

interface Props {
  /** The keyword to localize; `null` keeps the dialog closed. */
  readonly source: Keyword | null;
  readonly keywords: readonly Keyword[];
  readonly markets: readonly Market[];
  readonly onClose: () => void;
  /** The keywords created, to add to the list. */
  readonly onCreated: (created: Keyword[]) => void;
}

interface PickStepProps {
  readonly idPrefix: string;
  readonly available: readonly Market[];
  readonly state: AddToMarketsState;
  readonly onToggle: (marketId: string) => void;
}

function PickStep({
  idPrefix, available, state, onToggle
}: PickStepProps) {
  if (available.length === 0) {
    return <p className="text-sm text-gray-500">This keyword is already asked in every configured market.</p>;
  }
  return (
    <fieldset className="border-0 p-0 m-0" disabled={state.phase === 'suggesting'}>
      <legend className="text-sm font-medium text-gray-700 mb-2">Markets to add it to</legend>
      <div className="space-y-1">
        {available.map((market) => {
          const id = `${idPrefix}-pick-${market.market_id}`;
          return (
            <label key={market.market_id} htmlFor={id} className="flex items-center gap-2 text-sm text-gray-700">
              <input id={id} type="checkbox" checked={state.picked.includes(market.market_id)}
                onChange={() => onToggle(market.market_id)}
                className="w-4 h-4 text-gray-900 rounded border-gray-300 focus:ring-gray-900" />
              {market.name}
              <span className="text-xs text-gray-400">{market.language_name}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

interface ReviewStepProps {
  readonly idPrefix: string;
  readonly markets: readonly Market[];
  readonly state: AddToMarketsState;
  readonly onEdit: (marketId: string, keyword: string) => void;
}

function ReviewStep({
  idPrefix, markets, state, onEdit
}: ReviewStepProps) {
  return (
    <fieldset className="border-0 p-0 m-0 space-y-3" disabled={state.phase === 'creating'}>
      <legend className="text-sm text-gray-600 mb-2">
        How a local user would type it. Edit before creating; a blank field is skipped.
      </legend>
      {state.drafts.map((draft) => {
        const id = `${idPrefix}-draft-${draft.market_id}`;
        return (
          <div key={draft.market_id}>
            <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{marketName(draft.market_id, markets)}</label>
            <input id={id} type="text" value={draft.keyword} onChange={(event) => onEdit(draft.market_id, event.target.value)}
              className="w-full p-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>
        );
      })}
    </fieldset>
  );
}

function creatableCount(state: AddToMarketsState): number {
  return state.drafts.filter((draft) => draft.keyword.trim() !== '').length;
}

/**
 * "Add to markets…": the same question asked as a local user in other
 * markets would type it. The new keywords localize the source (they share its
 * concept) and join its groups; the source keyword is not changed.
 */
export function AddToMarketsDialog({
  source, keywords, markets, onClose, onCreated
}: Props) {
  const idPrefix = useId();
  const flow = useAddToMarkets(source, onCreated);
  const { state } = flow;
  const reviewing = state.phase === 'review' || state.phase === 'creating';
  const available = source === null ? [] : marketsAvailableFor(source, keywords, markets);
  const close = () => {
    flow.reset();
    onClose();
  };
  const create = async () => {
    if (await flow.create()) onClose();
  };

  return (
    <Modal isOpen={source !== null} onClose={close} title={`Add "${source?.keyword ?? ''}" to markets`} size="xl">
      <div className="space-y-4">
        {reviewing
          ? <ReviewStep idPrefix={idPrefix} markets={markets} state={state} onEdit={flow.editDraft} />
          : <PickStep idPrefix={idPrefix} available={available} state={state} onToggle={flow.togglePicked} />}
        <ErrorAlert message={state.error} />
        <div className="flex flex-wrap gap-2">
          {reviewing ? (
            <Button onClick={() => { void create(); }} disabled={state.phase === 'creating' || creatableCount(state) === 0}>
              {state.phase === 'creating' ? 'Creating…' : `Create ${creatableCount(state)} keyword(s)`}
            </Button>
          ) : (
            <Button onClick={() => { void flow.suggest(); }} disabled={state.phase === 'suggesting' || state.picked.length === 0}>
              {state.phase === 'suggesting' ? 'Suggesting…' : 'Suggest keywords'}
            </Button>
          )}
          <Button variant="ghost" onClick={close} disabled={state.phase === 'creating'}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}
