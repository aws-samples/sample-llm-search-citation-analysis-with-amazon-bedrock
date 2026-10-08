import { expect } from 'vitest';
import {
  act, renderHook, waitFor
} from '@testing-library/react';
import type { BedrockTier } from '../api/bedrockModels';
import {
  BedrockOutageError, buildBedrockListing, buildPassedTestPayload, SONNET_4_5
} from '../api/bedrockModels-fixtures';
import {
  mockApiGet, mockApiPost
} from '../api/clientMock-fixtures';
import { useBedrockModels } from './useBedrockModels';

/** The hook over a listing with `balanced` as the balanced tier, once the listing has loaded. */
export async function renderLoadedBedrockModels(balanced?: BedrockTier) {
  mockApiGet.mockResolvedValue(buildBedrockListing(balanced));
  const rendered = renderHook(useBedrockModels);
  await waitFor(() => expect(rendered.result.current.listing.status).toBe('ready'));
  return rendered;
}

/** The hook after its first listing failed with HTTP 500; the next listing succeeds. */
export async function renderBedrockModelsAfterOutage() {
  mockApiGet
    .mockResolvedValue(buildBedrockListing())
    .mockRejectedValueOnce(new BedrockOutageError('HTTP 500: Internal Server Error'));
  const rendered = renderHook(useBedrockModels);
  await waitFor(() => expect(rendered.result.current.listing.status).toBe('failed'));
  return rendered;
}

type BedrockModelsResult = Awaited<ReturnType<typeof renderLoadedBedrockModels>>['result'];

/** The balanced tier's editor. */
export function balancedEditor(result: BedrockModelsResult) {
  return result.current.editors[1];
}

/** Pick `model` for balanced and start its test, answered by `answer`. */
export function startBalancedTest(result: BedrockModelsResult, model: string, answer: Promise<unknown>): void {
  mockApiPost.mockReturnValue(answer);
  act(() => result.current.selectModel('balanced', model));
  act(() => result.current.testModel('balanced'));
}

/** Pick `model` for balanced and test it against `payload` (a validate answer). */
export async function pickAndTestBalanced(result: BedrockModelsResult, model: string, payload: unknown) {
  startBalancedTest(result, model, Promise.resolve(payload));
  await waitFor(() => expect(balancedEditor(result).test.status).toBe('done'));
}

/** The loaded hook with Sonnet 4.5 picked for balanced (saved: Sonnet 5.5) and not tested. */
export async function renderUntestedBalancedPick() {
  const rendered = await renderLoadedBedrockModels();
  act(() => rendered.result.current.selectModel('balanced', SONNET_4_5));
  return rendered;
}

/** The loaded hook with Sonnet 4.5 picked for balanced and passing its test. */
export async function renderPassedBalancedPick() {
  const rendered = await renderLoadedBedrockModels();
  await pickAndTestBalanced(rendered.result, SONNET_4_5, buildPassedTestPayload(SONNET_4_5));
  return rendered;
}
