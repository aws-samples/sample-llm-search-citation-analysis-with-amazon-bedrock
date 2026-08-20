import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { ProvidersConfig } from './ProvidersConfig';
import {
  buildProviderConfig, buildProvidersConfigProps 
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
    render(<ProvidersConfig {...buildProvidersConfigProps()} />);

    expect(screen.getByRole('status')).toHaveTextContent('Healthy');
  });

  it('reports when the provider account has run out of credit', () => {
    const providers = [buildProviderConfig({
      last_error: 'Your credit balance is too low',
      last_error_at: '2026-08-19T10:00:00Z',
      last_error_category: 'insufficient_credit',
    })];

    render(<ProvidersConfig {...buildProvidersConfigProps({ providers })} />);

    expect(screen.getByRole('status')).toHaveTextContent('No credit remaining on this provider account');
  });

  it('reports when the provider rejected the API key', () => {
    const providers = [buildProviderConfig({
      last_error_at: '2026-08-19T10:00:00Z',
      last_error_category: 'invalid_key',
    })];

    render(<ProvidersConfig {...buildProvidersConfigProps({ providers })} />);

    expect(screen.getByRole('status')).toHaveTextContent('API key rejected — check or replace the key');
  });

  it('reports when the provider is rate limiting requests', () => {
    const providers = [buildProviderConfig({
      last_error_at: '2026-08-19T10:00:00Z',
      last_error_category: 'rate_limited',
    })];

    render(<ProvidersConfig {...buildProvidersConfigProps({ providers })} />);

    expect(screen.getByRole('status')).toHaveTextContent('Rate limited by the provider');
  });

  it('reports when the provider did not respond in time', () => {
    const providers = [buildProviderConfig({
      last_error_at: '2026-08-19T10:00:00Z',
      last_error_category: 'timeout',
    })];

    render(<ProvidersConfig {...buildProvidersConfigProps({ providers })} />);

    expect(screen.getByRole('status')).toHaveTextContent('Provider did not respond in time');
  });

  it('reports an unclassified failure as an unrecognised error', () => {
    const providers = [buildProviderConfig({
      last_error_at: '2026-08-19T10:00:00Z',
      last_error_category: 'unknown',
    })];

    render(<ProvidersConfig {...buildProvidersConfigProps({ providers })} />);

    expect(screen.getByRole('status')).toHaveTextContent('Provider returned an unrecognised error');
  });

  it('shows how long ago the failure happened', () => {
    const providers = [buildProviderConfig({
      last_error_at: '2026-08-19T10:00:00Z',
      last_error_category: 'insufficient_credit',
    })];

    render(<ProvidersConfig {...buildProvidersConfigProps({ providers })} />);

    expect(screen.getByRole('status')).toHaveTextContent('2 hours ago');
  });

  it('keeps the raw provider error available for debugging', () => {
    const providers = [buildProviderConfig({
      last_error: 'Your credit balance is too low',
      last_error_at: '2026-08-19T10:00:00Z',
      last_error_category: 'insufficient_credit',
    })];

    render(<ProvidersConfig {...buildProvidersConfigProps({ providers })} />);

    expect(screen.getByRole('status')).toHaveAttribute('title', 'Your credit balance is too low');
  });

  it('marks the provider healthy again once a success follows the failure', () => {
    const providers = [buildProviderConfig({
      last_error_category: 'rate_limited',
      last_error_at: '2026-08-19T08:00:00Z',
      last_success_at: '2026-08-19T11:00:00Z',
    })];

    render(<ProvidersConfig {...buildProvidersConfigProps({ providers })} />);

    expect(screen.getByRole('status')).toHaveTextContent('Healthy');
  });

  it('shows no health badge for a provider without an API key', () => {
    const providers = [buildProviderConfig({
      configured: false,
      masked_key: null,
      last_success_at: undefined,
    })];

    render(<ProvidersConfig {...buildProvidersConfigProps({ providers })} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows no health badge for a configured provider that has never run', () => {
    const providers = [buildProviderConfig({ last_success_at: undefined })];

    render(<ProvidersConfig {...buildProvidersConfigProps({ providers })} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('ProvidersConfig auto-disabled provider', () => {
  const autoDisabledProviders = [buildProviderConfig({
    enabled: false,
    auto_disabled: true,
    disabled_reason: 'No credit remaining on this provider account',
    last_error: 'Your credit balance is too low',
    last_error_at: '2026-08-19T10:00:00Z',
    last_error_category: 'insufficient_credit',
    consecutive_failures: 3,
  })];

  it('states that the provider was switched off automatically', () => {
    render(<ProvidersConfig {...buildProvidersConfigProps({ providers: autoDisabledProviders })} />);

    expect(screen.getByRole('status')).toHaveTextContent('Switched off automatically');
  });

  it('says the system did it rather than the user', () => {
    render(<ProvidersConfig {...buildProvidersConfigProps({ providers: autoDisabledProviders })} />);

    expect(screen.getByText(/The system switched this provider off/)).toBeInTheDocument();
  });

  it('shows the reason it was switched off', () => {
    render(<ProvidersConfig {...buildProvidersConfigProps({ providers: autoDisabledProviders })} />);

    expect(screen.getByText(/No credit remaining on this provider account/)).toBeInTheDocument();
  });

  it('warns that turning the provider back on is a manual step', () => {
    render(<ProvidersConfig {...buildProvidersConfigProps({ providers: autoDisabledProviders })} />);

    expect(screen.getByText(/Re-enabling is manual/)).toBeInTheDocument();
  });

  it('shows no auto-disabled notice for a provider the user turned off', () => {
    const providers = [buildProviderConfig({ enabled: false })];

    render(<ProvidersConfig {...buildProvidersConfigProps({ providers })} />);

    expect(screen.queryByText(/The system switched this provider off/)).not.toBeInTheDocument();
  });
});
