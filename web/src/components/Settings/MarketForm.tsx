import {
  useEffect, useId, useState, type FormEvent
} from 'react';
import {
  useMarketProposal, type MarketProposalState
} from '../../hooks/useMarketProposal';
import type {
  Market, MarketProposalRequest
} from '../../types';
import { Button } from '../ui';
import { ErrorAlert } from '../ui/ErrorAlert';
import { Spinner } from '../ui/Spinner';
import { MarketDetailFields } from './MarketDetailFields';
import {
  emptyMarketFormValues, marketFormValues, marketFromForm, type MarketFormValues
} from './marketFormModel';
import { localeName } from './marketLocales';
import {
  EMPTY_CHOICE, MarketProposalFields, proposalRequest, sameRequest, type MarketChoice
} from './MarketProposalFields';
import { useFormValues } from './useFormValues';

/** Adding a market: the choice first, then the proposed details to check. Editing one starts at the details. */
type Step = 'choice' | 'details';

const STEP_TITLES: Record<Step, string> = {
  choice: 'Step 1 of 2 · Where keywords of this market are asked from',
  details: 'Step 2 of 2 · Check the details, then save',
};

interface MarketFormProps {
  /** The market being edited; `null` adds a new one. */
  readonly market: Market | null;
  /** The rest of the list, so a duplicate id is refused here. */
  readonly others: readonly Market[];
  readonly saving: boolean;
  readonly onSubmit: (market: Market) => void;
  readonly onCancel: () => void;
}

/** The details a choice implies on its own: what the check step shows when the model could not add to them. */
function valuesForChoice(choice: MarketChoice): MarketFormValues {
  return {
    ...emptyMarketFormValues(),
    country: choice.country,
    country_name: choice.country === '' ? '' : localeName(choice.country, 'region'),
    language: choice.language,
    language_name: choice.language === '' ? '' : localeName(choice.language, 'language'),
    city: choice.city.trim(),
  };
}

interface ProposalStatusProps {
  readonly state: MarketProposalState;
  readonly step: Step;
}

/** What the model is doing or did for the current choice; its answer is only reported on the check step. */
function ProposalStatus({
  state, step
}: ProposalStatusProps) {
  if (state.status === 'proposing') {
    return (
      <output className="flex items-center gap-2 text-sm text-gray-500">
        <Spinner size="sm" /> Asking the model for the currency, time zone, local competitors and brand names…
      </output>
    );
  }
  if (step === 'choice') return null;
  if (state.status === 'failed') return <ErrorAlert message={state.message} />;
  if (state.status === 'proposed') {
    return <output className="text-sm text-emerald-700">Proposed by the model. Check the details, edit what is wrong, then save.</output>;
  }
  return null;
}

interface FormActionsProps {
  readonly adding: boolean;
  readonly step: Step;
  readonly saving: boolean;
  readonly proposing: boolean;
  /** Whether the choice is complete enough to describe. */
  readonly ready: boolean;
  readonly onDescribeAgain: () => void;
  readonly onBack: () => void;
  readonly onCancel: () => void;
}

/** The buttons of the current step; the submit one describes on step 1 and saves on step 2. */
function FormActions({
  adding, step, saving, proposing, ready, onDescribeAgain, onBack, onCancel
}: FormActionsProps) {
  const busy = saving || proposing;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {step === 'choice' ? (
        <Button type="submit" disabled={busy || !ready}>{proposing ? 'Describing…' : 'Next: describe this market'}</Button>
      ) : (
        <Button type="submit" disabled={busy}>{saving ? 'Saving…' : 'Save market'}</Button>
      )}
      {adding && step === 'details' && (
        <>
          <Button variant="secondary" disabled={busy || !ready} onClick={onDescribeAgain}>Describe again</Button>
          <Button variant="ghost" onClick={onBack} disabled={busy}>Back</Button>
        </>
      )}
      <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
    </div>
  );
}

/**
 * Add or edit one market. A new market is a two-step form: the country, the
 * language and an optional city first; then the details the model proposed
 * for them, to check and save (or to fill in by hand when the model could not
 * answer). Submitting the first step describes the market, never saves it.
 * Editing shows the details directly. The check mirrors the server's, so a
 * save the form allows is not refused for its fields.
 */
export function MarketForm({
  market, others, saving, onSubmit, onCancel
}: MarketFormProps) {
  const idPrefix = useId();
  const adding = market === null;
  const {
    values, setValues, updateValue
  } = useFormValues<MarketFormValues>(() => (market === null ? emptyMarketFormValues() : marketFormValues(market)));
  const [choice, setChoice] = useState<MarketChoice>(EMPTY_CHOICE);
  const [step, setStep] = useState<Step>(adding ? 'choice' : 'details');
  const [problem, setProblem] = useState<string | null>(null);
  const {
    state, propose
  } = useMarketProposal();
  const request = proposalRequest(choice);
  const proposing = state.status === 'proposing';

  // A settled proposal moves the form to the check step; a successful one fills the details in.
  useEffect(() => {
    if (state.status === 'idle' || state.status === 'proposing') return;
    if (state.status === 'proposed') {
      const {
        market: proposed, market_id_taken: taken
      } = state.proposal;
      setValues(marketFormValues(proposed));
      setProblem(taken ? `market_id '${proposed.market_id}' is already configured; change it below` : null);
    }
    setStep('details');
  }, [state, setValues]);

  /** Ask the model about `toDescribe`; until it answers, the details hold only what the choice implies. */
  const describe = (toDescribe: MarketProposalRequest) => {
    setValues(valuesForChoice(choice));
    setProblem(null);
    propose(toDescribe);
  };

  /** Step 1 done: a choice the model already described shows its details again; any other is described first. */
  const next = () => {
    if (request === null) return;
    if (state.status === 'proposed' && sameRequest(state.request, request)) setStep('details');
    else describe(request);
  };

  const save = () => {
    const result = marketFromForm(values, others);
    setProblem(result.error);
    if (result.market !== null) onSubmit(result.market);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step === 'choice') next();
    else save();
  };

  return (
    <form onSubmit={handleSubmit} noValidate aria-label={adding ? 'Add market' : `Edit ${market.name}`}
      className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
      {adding && <h3 className="text-sm font-medium text-gray-700">{STEP_TITLES[step]}</h3>}
      {step === 'choice' ? (
        <MarketProposalFields choice={choice} disabled={saving || proposing} onChange={setChoice} />
      ) : (
        <fieldset disabled={saving || proposing}>
          <legend className="sr-only">Market details</legend>
          <MarketDetailFields idPrefix={idPrefix} values={values} idLocked={!adding} updateValue={updateValue} />
        </fieldset>
      )}
      {adding && <ProposalStatus state={state} step={step} />}
      <ErrorAlert message={problem} />
      <FormActions adding={adding} step={step} saving={saving} proposing={proposing} ready={request !== null}
        onDescribeAgain={() => {
          if (request !== null) describe(request);
        }}
        onBack={() => setStep('choice')} onCancel={onCancel} />
    </form>
  );
}
