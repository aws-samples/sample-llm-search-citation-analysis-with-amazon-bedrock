import {
  describe, expect, it, vi
} from 'vitest';
import {
  BedrockModelError, fetchBedrockModels, saveBedrockModel, testBedrockModel
} from './bedrockModels';
import {
  mockApiGet, mockApiPost, mockApiPut
} from './clientMock-fixtures';
import {
  BALANCED_ON_SONNET_4_5,
  buildBedrockListing,
  buildBedrockTier,
  buildDecodedPassedTest,
  buildFailedTestPayload,
  buildPassedTestPayload,
  DEEP_AT_DEFAULT,
  SONNET_4_5,
  SONNET_5_5,
} from './bedrockModels-fixtures';

vi.mock('./client', () => import('./clientMock-fixtures'));

const INVALID_LISTING = 'Bedrock API returned an invalid model list';
const INVALID_TEST = 'Bedrock API returned an invalid test result';

describe('fetchBedrockModels', () => {
  it('returns the tiers and models of the contract listing', async () => {
    mockApiGet.mockResolvedValue(buildBedrockListing(BALANCED_ON_SONNET_4_5));

    await expect(fetchBedrockModels()).resolves.toStrictEqual(buildBedrockListing(BALANCED_ON_SONNET_4_5));
  });

  it('asks for the Bedrock models and keeps the 502 body readable', async () => {
    mockApiGet.mockResolvedValue(buildBedrockListing());
    const controller = new AbortController();

    await fetchBedrockModels(controller.signal);

    expect(mockApiGet).toHaveBeenCalledWith('/providers/bedrock/models', {
      signal: controller.signal,
      acceptedJsonStatuses: [502],
    });
  });

  it('throws the listing failure together with its details', async () => {
    mockApiGet.mockResolvedValue({
      error: 'Could not list Bedrock models',
      details: 'AccessDeniedException',
    });

    await expect(fetchBedrockModels()).rejects.toThrow(BedrockModelError);
    await expect(fetchBedrockModels()).rejects.toThrow('Could not list Bedrock models: AccessDeniedException');
  });

  it.each([
    ['nothing', null],
    ['no tiers', { models: [] }],
    ['no models', { tiers: buildBedrockListing().tiers }],
    ['only two tiers', {
      ...buildBedrockListing(),
      tiers: buildBedrockListing().tiers.slice(0, 2),
    }],
    ['the tiers out of order', {
      ...buildBedrockListing(),
      tiers: [...buildBedrockListing().tiers].reverse(),
    }],
    ['an unknown tier', {
      ...buildBedrockListing(),
      tiers: [buildBedrockTier(), buildBedrockTier({ tier: 'balanced' }), {
        ...DEEP_AT_DEFAULT,
        tier: 'huge' 
      }],
    }],
    ['an unknown request style', {
      ...buildBedrockListing(),
      tiers: [{
        ...buildBedrockTier(),
        request_style: 'turbo' 
      }, ...buildBedrockListing().tiers.slice(1)],
    }],
    ['roles that are not text', {
      ...buildBedrockListing(),
      tiers: [{
        ...buildBedrockTier(),
        roles: [1] 
      }, ...buildBedrockListing().tiers.slice(1)],
    }],
    ['a model without a name', {
      ...buildBedrockListing(),
      models: [{ id: SONNET_5_5 }],
    }],
  ])('rejects a listing with %s', async (_shape, payload) => {
    mockApiGet.mockResolvedValue(payload);

    await expect(fetchBedrockModels()).rejects.toThrow(INVALID_LISTING);
  });
});

describe('testBedrockModel', () => {
  it('posts the tier and model to the validate endpoint', async () => {
    mockApiPost.mockResolvedValue(buildPassedTestPayload(SONNET_5_5));

    await testBedrockModel('balanced', SONNET_5_5);

    expect(mockApiPost).toHaveBeenCalledWith('/providers/bedrock/validate', {
      tier: 'balanced',
      model: SONNET_5_5,
    }, { acceptedJsonStatuses: [400] });
  });

  it('returns a passing test with its latency and quota', async () => {
    mockApiPost.mockResolvedValue(buildPassedTestPayload(SONNET_5_5));

    await expect(testBedrockModel('balanced', SONNET_5_5)).resolves.toStrictEqual(buildDecodedPassedTest(SONNET_5_5));
  });

  it('keeps a quota reading that is still under way', async () => {
    mockApiPost.mockResolvedValue(buildPassedTestPayload(SONNET_5_5, null, false));

    await expect(testBedrockModel('balanced', SONNET_5_5)).resolves.toHaveProperty('quota.complete', false);
  });

  it('treats a quota without the complete flag as complete', async () => {
    mockApiPost.mockResolvedValue({
      ...buildPassedTestPayload(SONNET_5_5),
      quota: {
        tokens_per_minute: null,
        requests_per_minute: null,
      },
    });

    await expect(testBedrockModel('balanced', SONNET_5_5)).resolves.toHaveProperty('quota.complete', true);
  });

  it('returns a passing test without a quota when none is published', async () => {
    mockApiPost.mockResolvedValue({
      ...buildPassedTestPayload(SONNET_5_5),
      quota: null,
    });

    await expect(testBedrockModel('balanced', SONNET_5_5)).resolves.toHaveProperty('quota', null);
  });

  it('returns a failing test with its reason and message rather than throwing', async () => {
    mockApiPost.mockResolvedValue(buildFailedTestPayload(SONNET_4_5, 'error', 'Bedrock timed out'));

    await expect(testBedrockModel('fast', SONNET_4_5)).resolves.toStrictEqual({
      valid: false,
      model: SONNET_4_5,
      reason: 'error',
      error: 'Bedrock timed out',
    });
  });

  it('throws the refusal of a malformed request', async () => {
    mockApiPost.mockResolvedValue({ error: 'Unknown tier' });

    await expect(testBedrockModel('fast', SONNET_5_5)).rejects.toThrow('Unknown tier');
  });

  it.each([
    ['an unknown reason', buildFailedTestPayload(SONNET_5_5, 'error'), { reason: 'gone' }],
    ['a pass without latency', buildPassedTestPayload(SONNET_5_5), { latency_ms: null }],
    ['a pass without a request style', buildPassedTestPayload(SONNET_5_5), { request_style: null }],
    ['a quota that is not a number', buildPassedTestPayload(SONNET_5_5), { quota: { tokens_per_minute: 'lots' } }],
    ['a complete flag that is not a boolean', buildPassedTestPayload(SONNET_5_5), {
      quota: {
        tokens_per_minute: null,
        requests_per_minute: null,
        complete: 'no',
      },
    }],
    ['no verdict', buildPassedTestPayload(SONNET_5_5), { valid: 'yes' }],
  ])('rejects a test result with %s', async (_shape, payload, change) => {
    mockApiPost.mockResolvedValue({
      ...payload,
      ...change,
    });

    await expect(testBedrockModel('balanced', SONNET_5_5)).rejects.toThrow(INVALID_TEST);
  });
});

describe('saveBedrockModel', () => {
  it('puts the tier, the model and the validate flag', async () => {
    mockApiPut.mockResolvedValue(BALANCED_ON_SONNET_4_5);

    await saveBedrockModel('balanced', SONNET_4_5);

    expect(mockApiPut).toHaveBeenCalledWith('/providers/bedrock', {
      tier: 'balanced',
      model: SONNET_4_5,
      validate: true,
    }, { acceptedJsonStatuses: [400] });
  });

  it('returns the updated tier', async () => {
    mockApiPut.mockResolvedValue(BALANCED_ON_SONNET_4_5);

    await expect(saveBedrockModel('balanced', SONNET_4_5)).resolves.toStrictEqual(BALANCED_ON_SONNET_4_5);
  });

  it('throws the details of a failed model check', async () => {
    mockApiPut.mockResolvedValue({
      error: 'Model check failed',
      details: 'The model is at capacity right now',
      reason: 'throttled',
    });

    await expect(saveBedrockModel('balanced', SONNET_4_5)).rejects.toThrow(/^The model is at capacity right now$/);
  });

  it('throws the bare refusal when it carries no details', async () => {
    mockApiPut.mockResolvedValue({ error: 'Model check failed' });

    await expect(saveBedrockModel('balanced', null)).rejects.toThrow(/^Model check failed$/);
  });

  it('rejects a saved tier that does not match the contract', async () => {
    mockApiPut.mockResolvedValue({ tier: 'balanced' });

    await expect(saveBedrockModel('balanced', SONNET_4_5)).rejects.toThrow('Bedrock API returned an invalid tier');
  });
});
