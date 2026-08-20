import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ProviderHealthBanner, PROVIDER_HEALTH_DISMISSED_STORAGE_KEY 
} from './ProviderHealthBanner';

vi.mock('../../hooks/useProviderConfig', () => ({useProviderConfig: vi.fn(),}));

import { useProviderConfig } from '../../hooks/useProviderConfig';
import {
  buildBannerProvider,
  buildCreditExhaustedProvider,
  buildProviderConfigHookResult
} from './ProviderHealthBanner-fixtures';

const mockUseProviderConfig = vi.mocked(useProviderConfig);

describe('ProviderHealthBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockUseProviderConfig.mockReturnValue(buildProviderConfigHookResult());
  });

  describe('visibility', () => {
    it('renders nothing when every enabled provider is healthy', () => {
      mockUseProviderConfig.mockReturnValue(buildProviderConfigHookResult({providers: [buildBannerProvider()],}));

      const { container } = render(<ProviderHealthBanner onNavigateToProviders={vi.fn()} />);

      expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing while the provider list is still loading', () => {
      mockUseProviderConfig.mockReturnValue(buildProviderConfigHookResult({
        providers: [buildCreditExhaustedProvider()],
        loading: true,
      }));

      const { container } = render(<ProviderHealthBanner onNavigateToProviders={vi.fn()} />);

      expect(container).toBeEmptyDOMElement();
    });

    it('warns when an enabled provider has stopped returning results', () => {
      mockUseProviderConfig.mockReturnValue(buildProviderConfigHookResult({providers: [buildCreditExhaustedProvider()],}));

      render(<ProviderHealthBanner onNavigateToProviders={vi.fn()} />);

      expect(screen.getByRole('alert')).toHaveTextContent('Claude is not returning results: no credit remaining');
    });

    it('warns about a provider the system switched off by itself', () => {
      mockUseProviderConfig.mockReturnValue(buildProviderConfigHookResult({
        providers: [buildCreditExhaustedProvider({
          enabled: false,
          auto_disabled: true,
          disabled_reason: 'No credit remaining on this provider account',
        })],
      }));

      render(<ProviderHealthBanner onNavigateToProviders={vi.fn()} />);

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Claude was switched off automatically: No credit remaining on this provider account'
      );
    });

    it('counts the affected providers in the headline when several are failing', () => {
      mockUseProviderConfig.mockReturnValue(buildProviderConfigHookResult({
        providers: [
          buildCreditExhaustedProvider(),
          buildCreditExhaustedProvider({
            id: 'openai',
            name: 'OpenAI',
            last_error_category: 'timeout',
          }),
        ],
      }));

      render(<ProviderHealthBanner onNavigateToProviders={vi.fn()} />);

      expect(screen.getByText('2 AI providers are not returning results')).toBeInTheDocument();
    });

    it('uses the singular headline when exactly one provider is failing', () => {
      mockUseProviderConfig.mockReturnValue(buildProviderConfigHookResult({providers: [buildCreditExhaustedProvider()],}));

      render(<ProviderHealthBanner onNavigateToProviders={vi.fn()} />);

      expect(screen.getByText('1 AI provider is not returning results')).toBeInTheDocument();
    });
  });

  describe('navigation to the fix', () => {
    it('opens the AI provider settings when the review link is used', async () => {
      const onNavigateToProviders = vi.fn();
      mockUseProviderConfig.mockReturnValue(buildProviderConfigHookResult({providers: [buildCreditExhaustedProvider()],}));
      render(<ProviderHealthBanner onNavigateToProviders={onNavigateToProviders} />);

      await userEvent.click(screen.getByRole('button', { name: 'Review AI provider settings' }));

      expect(onNavigateToProviders).toHaveBeenCalledWith();
    });
  });

  describe('dismissal', () => {
    beforeEach(() => {
      mockUseProviderConfig.mockReturnValue(buildProviderConfigHookResult({providers: [buildCreditExhaustedProvider()],}));
    });

    it('hides the warning once it is dismissed', async () => {
      render(<ProviderHealthBanner onNavigateToProviders={vi.fn()} />);

      await userEvent.click(screen.getByRole('button', { name: 'Dismiss provider warning' }));

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('stays hidden for the rest of the session after being dismissed', () => {
      sessionStorage.setItem(PROVIDER_HEALTH_DISMISSED_STORAGE_KEY, 'true');

      render(<ProviderHealthBanner onNavigateToProviders={vi.fn()} />);

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('records the dismissal in session storage rather than permanently', async () => {
      render(<ProviderHealthBanner onNavigateToProviders={vi.fn()} />);

      await userEvent.click(screen.getByRole('button', { name: 'Dismiss provider warning' }));

      expect(sessionStorage.getItem(PROVIDER_HEALTH_DISMISSED_STORAGE_KEY)).toBe('true');
      expect(localStorage.getItem(PROVIDER_HEALTH_DISMISSED_STORAGE_KEY)).toBeNull();
    });
  });
});
