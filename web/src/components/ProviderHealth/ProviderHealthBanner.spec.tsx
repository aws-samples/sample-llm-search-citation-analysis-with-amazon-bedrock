import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PROVIDER_HEALTH_DISMISSED_STORAGE_KEY } from './ProviderHealthBanner';

vi.mock('../../hooks/useProviderConfig', () => ({useProviderConfig: vi.fn(),}));

import {
  useProviderConfig, type ProviderConfig 
} from '../../hooks/useProviderConfig';
import {
  buildBannerProvider,
  buildCreditExhaustedProvider,
  buildProviderConfigHookResult,
  dismissBanner,
  renderBanner,
} from './ProviderHealthBanner-fixtures';

const mockUseProviderConfig = vi.mocked(useProviderConfig);

function mockProviders(providers: ProviderConfig[], loading = false) {
  mockUseProviderConfig.mockReturnValue(buildProviderConfigHookResult({
    providers,
    loading,
  }));
}

describe('ProviderHealthBanner', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockProviders([]);
  });

  describe('visibility', () => {
    it('renders nothing when every enabled provider is healthy', () => {
      mockProviders([buildBannerProvider()]);

      const { container } = renderBanner();

      expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing while the provider list is still loading', () => {
      mockProviders([buildCreditExhaustedProvider()], true);

      const { container } = renderBanner();

      expect(container).toBeEmptyDOMElement();
    });

    it('warns when an enabled provider has stopped returning results', () => {
      mockProviders([buildCreditExhaustedProvider()]);

      renderBanner();

      expect(screen.getByRole('alert')).toHaveTextContent('Claude is not returning results: no credit remaining');
    });

    it('warns about a provider the system switched off by itself', () => {
      mockProviders([buildCreditExhaustedProvider({
        enabled: false,
        auto_disabled: true,
        disabled_reason: 'No credit remaining on this provider account',
      })]);

      renderBanner();

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Claude was switched off automatically: No credit remaining on this provider account'
      );
    });

    it('counts the affected providers in the headline when several are failing', () => {
      mockProviders([
        buildCreditExhaustedProvider(),
        buildCreditExhaustedProvider({
          id: 'openai',
          name: 'OpenAI',
          last_error_category: 'timeout',
        }),
      ]);

      renderBanner();

      expect(screen.getByText('2 AI providers are not returning results')).toBeInTheDocument();
    });

    it('uses the singular headline when exactly one provider is failing', () => {
      mockProviders([buildCreditExhaustedProvider()]);

      renderBanner();

      expect(screen.getByText('1 AI provider is not returning results')).toBeInTheDocument();
    });
  });

  describe('navigation to the fix', () => {
    it('opens the AI provider settings when the review link is used', async () => {
      const onNavigateToProviders = vi.fn();
      mockProviders([buildCreditExhaustedProvider()]);
      renderBanner(onNavigateToProviders);

      await userEvent.click(screen.getByRole('button', { name: 'Review AI provider settings' }));

      expect(onNavigateToProviders).toHaveBeenCalledWith();
    });
  });

  describe('dismissal', () => {
    beforeEach(() => {
      mockProviders([buildCreditExhaustedProvider()]);
    });

    it('hides the warning once it is dismissed', async () => {
      renderBanner();

      await dismissBanner();

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('stays hidden for the rest of the session after being dismissed', () => {
      sessionStorage.setItem(PROVIDER_HEALTH_DISMISSED_STORAGE_KEY, 'true');

      renderBanner();

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('records the dismissal in session storage rather than permanently', async () => {
      renderBanner();

      await dismissBanner();

      expect(sessionStorage.getItem(PROVIDER_HEALTH_DISMISSED_STORAGE_KEY)).toBe('true');
      expect(localStorage.getItem(PROVIDER_HEALTH_DISMISSED_STORAGE_KEY)).toBeNull();
    });
  });
});
