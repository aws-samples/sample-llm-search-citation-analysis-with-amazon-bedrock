import {
  useCallback, useEffect, useRef, useState
} from 'react';
import {
  fetchBedrockModels,
  saveBedrockModel,
  testBedrockModel,
  type BedrockModelListing,
  type BedrockModelOption,
  type BedrockModelTest,
  type BedrockTier,
  type BedrockTierId,
} from '../api/bedrockModels';
import { useLatestRequest } from './useLatestRequest';

export type BedrockListingState =
  | { status: 'loading' }
  | {
    status: 'ready';
    listing: BedrockModelListing;
  }
  | {
    status: 'failed';
    message: string;
  };

export type BedrockTestState =
  | { status: 'idle' }
  | {
    status: 'testing';
    model: string;
  }
  | {
    status: 'done';
    result: BedrockModelTest;
  };

export type BedrockSaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved' }
  | {
    status: 'failed';
    message: string;
  };

/** Everything one tier card shows and edits. */
export interface BedrockTierEditor {
  readonly tier: BedrockTier;
  /** The model picked in the dropdown (the saved one until changed). */
  readonly draft: string;
  readonly test: BedrockTestState;
  readonly save: BedrockSaveState;
  /** The draft differs from the saved model and passed a test of exactly that model. */
  readonly canSave: boolean;
}

type PerTier<TValue> = Record<BedrockTierId, TValue>;

const IDLE_TEST: BedrockTestState = { status: 'idle' };
const IDLE_SAVE: BedrockSaveState = { status: 'idle' };

function perTier<TValue>(value: TValue): PerTier<TValue> {
  return {
    fast: value,
    balanced: value,
    deep: value,
  };
}

function savedModels(tiers: readonly BedrockTier[]): PerTier<string> {
  return tiers.reduce((models, tier) => ({
    ...models,
    [tier.tier]: tier.model,
  }), perTier(''));
}

/** The message of a thrown error, else `fallback` (a rejection that is not an `Error` carries none). */
function failureMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return fallback;
}

/** Whether `test` is a passing test of exactly `model`. */
function passedFor(test: BedrockTestState, model: string): boolean {
  return test.status === 'done' && test.result.valid && test.result.model === model;
}

function buildEditor(tier: BedrockTier, draft: string, test: BedrockTestState, save: BedrockSaveState): BedrockTierEditor {
  return {
    tier,
    draft,
    test,
    save,
    canSave: draft !== tier.model && save.status !== 'saving' && passedFor(test, draft),
  };
}

function withTier(listing: BedrockListingState, updated: BedrockTier): BedrockListingState {
  if (listing.status !== 'ready') return listing;
  return {
    status: 'ready',
    listing: {
      ...listing.listing,
      tiers: listing.listing.tiers.map((tier) => (tier.tier === updated.tier ? updated : tier)),
    },
  };
}

/** A failed request reads like a failed test whose reason is the request's error. */
function requestFailure(model: string, error: unknown): BedrockModelTest {
  return {
    valid: false,
    model,
    reason: 'error',
    error: failureMessage(error, 'The test could not run'),
  };
}

/** Per-tier state setter: `setFor(tier, value)` replaces one tier's entry. */
function usePerTier<TValue>(initial: TValue) {
  const [values, setValues] = useState<PerTier<TValue>>(() => perTier(initial));
  const setFor = useCallback((tier: BedrockTierId, value: TValue) => {
    setValues((previous) => ({
      ...previous,
      [tier]: value,
    }));
  }, []);
  return [values, setFor, setValues] as const;
}

/**
 * Settings › Bedrock models: the tiers and the models the account can use,
 * the model picked per tier, its latest test and the save in flight. A test
 * only counts for the model it tested: picking another model clears it, and a
 * test that answers after the pick changed is dropped.
 */
export function useBedrockModels() {
  const {
    beginRequest, isMounted
  } = useLatestRequest();
  const [listing, setListing] = useState<BedrockListingState>({ status: 'loading' });
  const [drafts, setDraft, setDrafts] = usePerTier('');
  const [tests, setTest, setTests] = usePerTier(IDLE_TEST);
  const [saves, setSave, setSaves] = usePerTier(IDLE_SAVE);
  const testGenerations = useRef(perTier(0));

  const load = useCallback(() => {
    const request = beginRequest();
    fetchBedrockModels(request.signal)
      .then((loaded) => {
        if (!request.isCurrent()) return;
        setListing({
          status: 'ready',
          listing: loaded,
        });
        setDrafts(savedModels(loaded.tiers));
        setTests(perTier(IDLE_TEST));
        setSaves(perTier(IDLE_SAVE));
      })
      .catch((error: unknown) => {
        if (request.isCurrent()) setListing({
          status: 'failed',
          message: failureMessage(error, 'Could not list the Bedrock models'),
        });
      })
      .finally(request.finish);
  }, [beginRequest, setDrafts, setTests, setSaves]);

  useEffect(load, [load]);

  const retry = useCallback(() => {
    setListing({ status: 'loading' });
    load();
  }, [load]);

  /** Forget the tier's test (and any answer still on its way). */
  const clearTest = useCallback((tier: BedrockTierId) => {
    testGenerations.current[tier] += 1;
    setTest(tier, IDLE_TEST);
  }, [setTest]);

  const selectModel = useCallback((tier: BedrockTierId, model: string) => {
    setDraft(tier, model);
    clearTest(tier);
    setSave(tier, IDLE_SAVE);
  }, [setDraft, clearTest, setSave]);

  const testModel = (tier: BedrockTierId) => {
    const model = drafts[tier];
    testGenerations.current[tier] += 1;
    const generation = testGenerations.current[tier];
    const isCurrent = () => isMounted() && testGenerations.current[tier] === generation;
    setTest(tier, {
      status: 'testing',
      model,
    });
    setSave(tier, IDLE_SAVE);
    void testBedrockModel(tier, model)
      .catch((error: unknown) => requestFailure(model, error))
      .then((result) => {
        if (isCurrent()) setTest(tier, {
          status: 'done',
          result,
        });
      });
  };

  const persist = async (tier: BedrockTierId, model: string | null) => {
    setSave(tier, { status: 'saving' });
    try {
      const updated = await saveBedrockModel(tier, model);
      if (!isMounted()) return;
      setListing((previous) => withTier(previous, updated));
      setDraft(tier, updated.model);
      if (model === null) clearTest(tier);
      setSave(tier, { status: 'saved' });
    } catch (error) {
      if (isMounted()) setSave(tier, {
        status: 'failed',
        message: failureMessage(error, 'Could not save the model'),
      });
    }
  };

  const editors: BedrockTierEditor[] = listing.status === 'ready'
    ? listing.listing.tiers.map((tier) => buildEditor(tier, drafts[tier.tier], tests[tier.tier], saves[tier.tier]))
    : [];
  const models: BedrockModelOption[] = listing.status === 'ready' ? listing.listing.models : [];

  return {
    listing,
    models,
    editors,
    retry,
    selectModel,
    testModel,
    /** Store the tier's draft; does nothing until `canSave`. */
    saveModel: async (tier: BedrockTierId) => {
      if (editors.some((editor) => editor.tier.tier === tier && editor.canSave)) await persist(tier, drafts[tier]);
    },
    /** Return the tier to its default model. */
    restoreDefault: (tier: BedrockTierId) => persist(tier, null),
  };
}

export type BedrockModelsController = ReturnType<typeof useBedrockModels>;
