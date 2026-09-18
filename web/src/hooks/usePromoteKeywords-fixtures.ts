import { expect } from 'vitest';
import {
  act, renderHook, type RenderOptions 
} from '@testing-library/react';
import type {
  Keyword, ResearchKeyword 
} from '../types';
import { usePromoteKeywords } from './usePromoteKeywords';

export const availableKeywordFixtures = [{
  keyword: 'alpha',
  intent: 'commercial',
  competition: 'high',
  relevance: 90,
}] satisfies ResearchKeyword[];

export const replacementAvailableKeywordFixtures = [{
  keyword: 'beta',
  intent: 'informational',
  competition: 'low',
  relevance: 70,
}] satisfies ResearchKeyword[];

export const createdKeywordItemFixture = {
  id: 'keyword-1',
  keyword: 'alpha',
  status: 'active',
  created_at: '2024-01-15T10:30:00Z',
  updated_at: '2024-01-15T10:30:00Z',
  region: 'global',
  language: 'en',
  category: '',
  priority: 'normal',
  notes: 'intent: commercial; competition: high',
};

export const successfulPromotionResponseFixture = {
  created: 1,
  skipped: 0,
  created_keywords: [createdKeywordItemFixture],
  skipped_keywords: [],
};

interface PromotionRequestResolution { resolve: ((response: typeof successfulPromotionResponseFixture) => void) | null; }

export function createMockPromotionRequest() {
  const requestResolution: PromotionRequestResolution = { resolve: null };
  const promise = new Promise<typeof successfulPromotionResponseFixture>((resolve) => {
    requestResolution.resolve = resolve;
  });

  return {
    promise,
    resolve: (response = successfulPromotionResponseFixture): void => {
      requestResolution.resolve?.(response);
    },
  };
}

type PromotionRequestArguments = [
  endpoint: string,
  body: { keywords: ResearchKeyword[] },
  options: {
    signal: unknown;
    allowStructured4xx: boolean 
  },
];

/**
 * `apiPost` arguments of a promotion of the fixture keywords whose request
 * has been aborted (by unmount, cleared selection or changed keywords).
 */
export const abortedPromotionRequest: PromotionRequestArguments = [
  '/keywords/promote',
  { keywords: availableKeywordFixtures },
  {
    signal: expect.objectContaining({ aborted: true }),
    allowStructured4xx: true,
  },
];

interface PromotionRenderOptions {
  onKeywordsAdded?: (created: Keyword[]) => void;
  wrapper?: RenderOptions['wrapper'];
}

/**
 * Renders the hook with the fixture keywords as rerender-able props and
 * selects 'alpha', so a promotion can be started next.
 */
export function renderSelectedPromotion(options: PromotionRenderOptions = {}) {
  const rendered = renderHook(
    ({ availableKeywords }) => usePromoteKeywords(availableKeywords, options.onKeywordsAdded),
    {
      initialProps: { availableKeywords: availableKeywordFixtures },
      wrapper: options.wrapper,
    }
  );
  act(() => {
    rendered.result.current.toggle('alpha');
  });
  return rendered;
}

/**
 * Renders the hook, selects 'alpha' and starts a promotion without awaiting
 * it. The caller scripts `apiPost`, so the request stays in flight until that
 * mock settles.
 */
export function renderPendingPromotion(options: PromotionRenderOptions = {}) {
  const rendered = renderSelectedPromotion(options);
  act(() => {
    void rendered.result.current.promote();
  });
  return rendered;
}
