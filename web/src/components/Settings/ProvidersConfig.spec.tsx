import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { ProvidersConfig } from './ProvidersConfig';
import {
  buildCreditExhaustedProvider, buildProviderConfig, buildProvidersConfigProps, renderProvidersConfig 
} from './ProvidersConfig-fixtures';

describe('ProvidersConfig', () => {
  it('shows the masked key of a configured provider', () => {
    render(<ProvidersConfig {...buildProvidersConfigProps()} />);

    expect(screen.getByText('sk-ant-...xyz')).toBeInTheDocument();
  });

  it('shows a loading message instead of the cards while providers load', () => {
    render(<ProvidersConfig {...buildProvidersConfigProps({ loading: true })} />);

    expect(screen.getByText('Loading providers...')).toBeInTheDocument();
    expect(screen.queryByText('sk-ant-...xyz')).not.toBeInTheDocument();
  });
});

describe('ProvidersConfig health badge', () => {
  /**
   * AUDIT-2026-08-19: Anthropic rejected every request for insufficient credit
   * from 2026-08-14 and the Settings panel said nothing. Each case below is one
   * classification the backend can record.
   */

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-19T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports a provider with a recent success as healthy', () => {
    renderProvidersConfig([buildProviderConfig()]);

    expect(screen.getByRole('status')).toHaveTextContent('Healthy');
  });

  it('reports when the provider account has run out of credit', () => {
    renderProvidersConfig([buildCreditExhaustedProvider()]);

    expect(screen.getByRole('status')).toHaveTextContent('No credit remaining on this provider account');
  });

  const failureLabels = [
    {
      category: 'invalid_key',
      label: 'API key rejected — check or replace the key',
    },
    {
      category: 'rate_limited',
      label: 'Rate limited by the provider',
    },
    {
      category: 'timeout',
      label: 'Provider did not respond in time',
    },
    {
      category: 'unknown',
      label: 'Provider returned an unrecognised error',
    },
  ] as const;

  it.each(failureLabels)('reports a $category failure as "$label"', ({
    category, label 
  }) => {
    renderProvidersConfig([buildProviderConfig({
      last_error_at: '2026-08-19T10:00:00Z',
      last_error_category: category,
    })]);

    expect(screen.getByRole('status')).toHaveTextContent(label);
  });

  it('shows how long ago the failure happened', () => {
    renderProvidersConfig([buildCreditExhaustedProvider()]);

    expect(screen.getByRole('status')).toHaveTextContent('2 hours ago');
  });

  it('keeps the raw provider error available for debugging', () => {
    renderProvidersConfig([buildCreditExhaustedProvider()]);

    expect(screen.getByRole('status')).toHaveAttribute('title', 'Your credit balance is too low');
  });

  it('marks the provider healthy again once a success follows the failure', () => {
    renderProvidersConfig([buildProviderConfig({
      last_error_category: 'rate_limited',
      last_error_at: '2026-08-19T08:00:00Z',
      last_success_at: '2026-08-19T11:00:00Z',
    })]);

    expect(screen.getByRole('status')).toHaveTextContent('Healthy');
  });

  it('shows no health badge for a provider without an API key', () => {
    renderProvidersConfig([buildProviderConfig({
      configured: false,
      masked_key: null,
      last_success_at: undefined,
    })]);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows no health badge for a configured provider that has never run', () => {
    renderProvidersConfig([buildProviderConfig({ last_success_at: undefined })]);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('ProvidersConfig auto-disabled provider', () => {
  const autoDisabledProviders = [buildCreditExhaustedProvider({
    enabled: false,
    auto_disabled: true,
    disabled_reason: 'No credit remaining on this provider account',
  })];

  it('states that the provider was switched off automatically', () => {
    renderProvidersConfig(autoDisabledProviders);

    expect(screen.getByRole('status')).toHaveTextContent('Switched off automatically');
  });

  it('says the system did it rather than the user', () => {
    renderProvidersConfig(autoDisabledProviders);

    expect(screen.getByText(/The system switched this provider off/)).toBeInTheDocument();
  });

  it('shows the reason it was switched off', () => {
    renderProvidersConfig(autoDisabledProviders);

    expect(screen.getByText(/No credit remaining on this provider account/)).toBeInTheDocument();
  });

  it('warns that turning the provider back on is a manual step', () => {
    renderProvidersConfig(autoDisabledProviders);

    expect(screen.getByText(/Re-enabling is manual/)).toBeInTheDocument();
  });

  it('shows no auto-disabled notice for a provider the user turned off', () => {
    renderProvidersConfig([buildProviderConfig({ enabled: false })]);

    expect(screen.queryByText(/The system switched this provider off/)).not.toBeInTheDocument();
  });
});
