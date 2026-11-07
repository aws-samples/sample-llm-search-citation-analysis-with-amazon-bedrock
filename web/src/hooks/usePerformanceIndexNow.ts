import {
  useCallback, useState
} from 'react';
import { seoErrorMessage } from '../api/seo';
import {
  checkIndexNowKeyFile, createIndexNowKey, fetchIndexNowSetup, submitIndexNow
} from '../api/seoPerformance';
import type {
  IndexNowSetup, IndexNowSubmission, KeyFileCheck, SubmitRequest
} from '../types/api/seoPerformance';
import {
  useSiteAuditLoad, type SiteAuditLoadState
} from './useSiteAuditLoad';

/** One IndexNow action's outcome: nothing yet, under way, its answer or its error. */
export type ActionState<T> =
  | { readonly status: 'idle' }
  | { readonly status: 'busy' }
  | {
    readonly status: 'done';
    readonly value: T;
  }
  | {
    readonly status: 'error';
    readonly message: string;
  };

export interface IndexNowController {
  readonly setup: SiteAuditLoadState<IndexNowSetup>;
  /** Key creation (Admin), per domain. */
  readonly keyAction: ActionState<string>;
  readonly createKey: (domain: string) => Promise<void>;
  readonly checks: Readonly<Record<string, ActionState<KeyFileCheck>>>;
  readonly checkKeyFile: (domain: string) => Promise<void>;
  readonly submission: ActionState<IndexNowSubmission>;
  readonly submit: (request: SubmitRequest) => Promise<void>;
}

async function settle<T>(action: () => Promise<T>): Promise<ActionState<T>> {
  try {
    return {
      status: 'done',
      value: await action()
    };
  } catch (failure) {
    console.error('[seo] IndexNow action failed:', failure);
    return {
      status: 'error',
      message: seoErrorMessage(failure)
    };
  }
}

/**
 * The IndexNow tab: the free setup read on mount (keys, where to host them, the last 20 submissions), and
 * the actions a click runs: create a key, check the key file (free), submit URLs (free, Admin). The setup
 * is read again after a key is created or URLs are submitted, so the history stays current.
 */
export function usePerformanceIndexNow(): IndexNowController {
  const {
    state: setup, reload 
  } = useSiteAuditLoad('indexnow', (signal) => fetchIndexNowSetup({ signal }));
  const [keyAction, setKeyAction] = useState<ActionState<string>>({ status: 'idle' });
  const [checks, setChecks] = useState<Record<string, ActionState<KeyFileCheck>>>({});
  const [submission, setSubmission] = useState<ActionState<IndexNowSubmission>>({ status: 'idle' });

  const createKey = useCallback(async (domain: string) => {
    setKeyAction({ status: 'busy' });
    setKeyAction(await settle(async () => (await createIndexNowKey(domain)).site.domain));
    reload();
  }, [reload]);

  const checkKeyFile = useCallback(async (domain: string) => {
    setChecks((current) => ({
      ...current,
      [domain]: { status: 'busy' }
    }));
    const outcome = await settle(() => checkIndexNowKeyFile(domain));
    setChecks((current) => ({
      ...current,
      [domain]: outcome
    }));
  }, []);

  const submit = useCallback(async (request: SubmitRequest) => {
    setSubmission({ status: 'busy' });
    setSubmission(await settle(async () => (await submitIndexNow(request)).submission));
    reload();
  }, [reload]);

  return {
    setup,
    keyAction,
    createKey,
    checks,
    checkKeyFile,
    submission,
    submit
  };
}
