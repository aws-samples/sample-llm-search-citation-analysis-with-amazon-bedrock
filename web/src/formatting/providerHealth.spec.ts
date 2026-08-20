import {
  describe, it, expect 
} from 'vitest';
import {
  describeProviderHealth, findUnhealthyProviders 
} from './providerHealth';
import {
  buildAutoDisabledCandidate,
  buildProviderHealthCandidate,
  creditExhaustedRecord
} from './providerHealth-fixtures';

describe('describeProviderHealth', () => {
  it('returns null when the provider has no API key configured', () => {
    const provider = buildProviderHealthCandidate({
      configured: false,
      last_success_at: undefined,
    });

    expect(describeProviderHealth(provider)).toBeNull();
  });

  it('returns null when the provider is configured but has never run', () => {
    const provider = buildProviderHealthCandidate({ last_success_at: undefined });

    expect(describeProviderHealth(provider)).toBeNull();
  });

  it('reports Healthy against the last success when no error is recorded', () => {
    const provider = buildProviderHealthCandidate({ last_success_at: '2026-08-19T09:00:00Z' });

    expect(describeProviderHealth(provider)).toStrictEqual({
      tone: 'ok',
      label: 'Healthy',
      occurredAt: '2026-08-19T09:00:00Z',
    });
  });

  it('reports Healthy when a later success supersedes an earlier failure', () => {
    const provider = buildProviderHealthCandidate({
      ...creditExhaustedRecord,
      last_success_at: '2026-08-19T11:00:00Z',
    });

    expect(describeProviderHealth(provider)?.tone).toBe('ok');
  });

  describe('error categories', () => {
    it('reports missing credit as a critical problem', () => {
      const provider = buildProviderHealthCandidate(creditExhaustedRecord);

      expect(describeProviderHealth(provider)).toStrictEqual({
        tone: 'critical',
        label: 'No credit remaining on this provider account',
        occurredAt: '2026-08-19T10:00:00Z',
        rawError: 'Your credit balance is too low',
      });
    });

    it('reports a rejected key as a critical problem', () => {
      const provider = buildProviderHealthCandidate({
        last_error_category: 'invalid_key',
        last_error_at: '2026-08-19T10:00:00Z',
      });

      expect(describeProviderHealth(provider)?.label).toBe('API key rejected — check or replace the key');
      expect(describeProviderHealth(provider)?.tone).toBe('critical');
    });

    it('reports rate limiting as a softer warning', () => {
      const provider = buildProviderHealthCandidate({
        last_error_category: 'rate_limited',
        last_error_at: '2026-08-19T10:00:00Z',
      });

      expect(describeProviderHealth(provider)?.label).toBe('Rate limited by the provider');
      expect(describeProviderHealth(provider)?.tone).toBe('warning');
    });

    it('reports a timeout as a softer warning', () => {
      const provider = buildProviderHealthCandidate({
        last_error_category: 'timeout',
        last_error_at: '2026-08-19T10:00:00Z',
      });

      expect(describeProviderHealth(provider)?.label).toBe('Provider did not respond in time');
      expect(describeProviderHealth(provider)?.tone).toBe('warning');
    });

    it('reports an explicitly unknown category as an unrecognised error', () => {
      const provider = buildProviderHealthCandidate({ last_error_category: 'unknown' });

      expect(describeProviderHealth(provider)?.label).toBe('Provider returned an unrecognised error');
    });

    it('falls back to the unrecognised message when an older row carries no category', () => {
      const provider = buildProviderHealthCandidate({ last_error: 'Something broke' });

      expect(describeProviderHealth(provider)?.label).toBe('Provider returned an unrecognised error');
    });
  });

  describe('auto-disabled providers', () => {
    it('states that the system switched the provider off', () => {
      const provider = buildAutoDisabledCandidate();

      expect(describeProviderHealth(provider)?.label).toBe('Switched off automatically');
    });

    it('gives the recorded reason and says re-enabling is manual', () => {
      const provider = buildAutoDisabledCandidate();

      expect(describeProviderHealth(provider)?.autoDisabledNote).toBe(
        'No credit remaining on this provider account. Re-enabling is manual — fix the problem, then turn it back on.'
      );
    });

    it('derives the reason from the error category when disabled_reason is absent', () => {
      const provider = buildAutoDisabledCandidate({
        disabled_reason: undefined,
        last_error_category: 'invalid_key',
      });

      expect(describeProviderHealth(provider)?.autoDisabledNote).toBe(
        'API key rejected — check or replace the key. Re-enabling is manual — fix the problem, then turn it back on.'
      );
    });

    it('stays critical even when a later success is recorded', () => {
      const provider = buildAutoDisabledCandidate({ last_success_at: '2026-08-20T10:00:00Z' });

      expect(describeProviderHealth(provider)?.tone).toBe('critical');
    });
  });
});

describe('findUnhealthyProviders', () => {
  it('returns an empty list when every enabled provider is healthy', () => {
    const providers = [buildProviderHealthCandidate()];

    expect(findUnhealthyProviders(providers)).toStrictEqual([]);
  });

  it('names the provider and the cause for a failing provider', () => {
    const providers = [buildProviderHealthCandidate(creditExhaustedRecord)];

    expect(findUnhealthyProviders(providers)).toStrictEqual([{
      id: 'claude',
      tone: 'critical',
      summary: 'Claude is not returning results: no credit remaining',
    }]);
  });

  it('says the provider was switched off when it was auto-disabled', () => {
    const providers = [buildAutoDisabledCandidate()];

    expect(findUnhealthyProviders(providers)[0].summary).toBe(
      'Claude was switched off automatically: No credit remaining on this provider account'
    );
  });

  it('includes auto-disabled providers even though they are no longer enabled', () => {
    const providers = [buildAutoDisabledCandidate()];

    expect(findUnhealthyProviders(providers)).toHaveLength(1);
  });

  it('ignores a failing provider the user has deliberately turned off', () => {
    const providers = [buildProviderHealthCandidate({
      ...creditExhaustedRecord,
      enabled: false,
    })];

    expect(findUnhealthyProviders(providers)).toStrictEqual([]);
  });

  it('lists every unhealthy provider in input order', () => {
    const providers = [
      buildProviderHealthCandidate({
        id: 'openai',
        name: 'OpenAI',
        last_error_category: 'rate_limited',
        last_error_at: '2026-08-19T10:00:00Z',
      }),
      buildProviderHealthCandidate(),
      buildProviderHealthCandidate({
        ...creditExhaustedRecord,
        id: 'gemini',
        name: 'Gemini',
      }),
    ];

    expect(findUnhealthyProviders(providers).map((entry) => entry.id)).toStrictEqual(['openai', 'gemini']);
  });
});
