import { act } from '@testing-library/react';
import {
  describe, expect, it, vi
} from 'vitest';
import {
  balancedEditor,
  pickAndTestBalanced,
  renderBedrockModelsAfterOutage,
  renderLoadedBedrockModels,
  renderPassedBalancedPick,
  renderUntestedBalancedPick,
  startBalancedTest,
} from './useBedrockModels-fixtures';
import { mockApiPut } from '../api/clientMock-fixtures';
import {
  BALANCED_AT_DEFAULT,
  BALANCED_ON_SONNET_4_5,
  BedrockOutageError,
  buildFailedTestPayload,
  buildDecodedPassedTest,
  buildPassedTestPayload,
  HAIKU_5_5,
  OPUS_5_5,
  RESTORE_BALANCED_DEFAULT_REQUEST,
  SONNET_4_5,
  SONNET_5_5,
} from '../api/bedrockModels-fixtures';
import { createDeferredValue } from '../test/fetchResponses';

vi.mock('../api/client', () => import('../api/clientMock-fixtures'));

describe('useBedrockModels listing', () => {
  it('starts every tier from the model it runs on now', async () => {
    const { result } = await renderLoadedBedrockModels(BALANCED_ON_SONNET_4_5);

    expect(result.current.editors.map((editor) => editor.draft)).toStrictEqual([HAIKU_5_5, SONNET_4_5, OPUS_5_5]);
  });

  it('reports why the listing failed', async () => {
    const { result } = await renderBedrockModelsAfterOutage();

    expect(result.current.listing).toStrictEqual({
      status: 'failed',
      message: 'HTTP 500: Internal Server Error',
    });
  });

  it('loads the listing again on retry', async () => {
    const { result } = await renderBedrockModelsAfterOutage();

    await act(async () => result.current.retry());

    expect(result.current.editors).toHaveLength(3);
  });
});

describe('useBedrockModels tests', () => {
  it('keeps the passing test of the picked model', async () => {
    const { result } = await renderPassedBalancedPick();

    expect(balancedEditor(result).test).toStrictEqual({
      status: 'done',
      result: buildDecodedPassedTest(SONNET_4_5),
    });
  });

  it('clears the test result when another model is picked', async () => {
    const { result } = await renderPassedBalancedPick();

    act(() => result.current.selectModel('balanced', OPUS_5_5));

    expect(balancedEditor(result).test).toStrictEqual({ status: 'idle' });
  });

  it('drops a test answer that arrives after another model was picked', async () => {
    const { result } = await renderLoadedBedrockModels();
    const pending = createDeferredValue<unknown>();
    startBalancedTest(result, SONNET_4_5, pending.promise);

    act(() => result.current.selectModel('balanced', OPUS_5_5));
    await act(async () => pending.resolve(buildPassedTestPayload(SONNET_4_5)));

    expect(balancedEditor(result).test.status).toBe('idle');
  });

  it('turns a test request that could not run into a failed test with its error', async () => {
    const { result } = await renderLoadedBedrockModels();

    await act(async () => startBalancedTest(result, SONNET_5_5, Promise.reject(new BedrockOutageError('HTTP 504: Gateway Timeout'))));

    expect(balancedEditor(result).test).toStrictEqual({
      status: 'done',
      result: {
        valid: false,
        model: SONNET_5_5,
        reason: 'error',
        error: 'HTTP 504: Gateway Timeout',
      },
    });
  });
});

describe('useBedrockModels canSave', () => {
  it('stays false for a changed model that was not tested', async () => {
    const { result } = await renderUntestedBalancedPick();

    expect(balancedEditor(result).canSave).toBe(false);
  });

  it('turns true once the changed model passed its test', async () => {
    const { result } = await renderPassedBalancedPick();

    expect(balancedEditor(result).canSave).toBe(true);
  });

  it('stays false when the changed model failed its test', async () => {
    const { result } = await renderLoadedBedrockModels();

    await pickAndTestBalanced(result, SONNET_4_5, buildFailedTestPayload(SONNET_4_5, 'throttled'));

    expect(balancedEditor(result).canSave).toBe(false);
  });

  it('stays false when the passing test was of the saved model', async () => {
    const { result } = await renderLoadedBedrockModels();

    await pickAndTestBalanced(result, SONNET_5_5, buildPassedTestPayload(SONNET_5_5));

    expect(balancedEditor(result).canSave).toBe(false);
  });
});

describe('useBedrockModels saving', () => {
  it('replaces the tier with the one the server stored', async () => {
    const { result } = await renderPassedBalancedPick();
    mockApiPut.mockResolvedValue(BALANCED_ON_SONNET_4_5);

    await act(() => result.current.saveModel('balanced'));

    expect(balancedEditor(result)).toMatchObject({
      tier: BALANCED_ON_SONNET_4_5,
      save: { status: 'saved' },
      canSave: false,
    });
  });

  it('sends nothing while the draft has no passing test', async () => {
    const { result } = await renderUntestedBalancedPick();

    await act(() => result.current.saveModel('balanced'));

    expect(mockApiPut.mock.calls).toHaveLength(0);
  });

  it('keeps the refusal details of a failed save', async () => {
    const { result } = await renderPassedBalancedPick();
    mockApiPut.mockResolvedValue({
      error: 'Model check failed',
      details: 'Access denied for this model.',
    });

    await act(() => result.current.saveModel('balanced'));

    expect(balancedEditor(result).save).toStrictEqual({
      status: 'failed',
      message: 'Access denied for this model.',
    });
  });

  it('returns a changed tier to its default model', async () => {
    const { result } = await renderLoadedBedrockModels(BALANCED_ON_SONNET_4_5);
    mockApiPut.mockResolvedValue(BALANCED_AT_DEFAULT);

    await act(() => result.current.restoreDefault('balanced'));

    expect(mockApiPut).toHaveBeenCalledWith(...RESTORE_BALANCED_DEFAULT_REQUEST);
    expect(balancedEditor(result).draft).toBe(SONNET_5_5);
  });
});
