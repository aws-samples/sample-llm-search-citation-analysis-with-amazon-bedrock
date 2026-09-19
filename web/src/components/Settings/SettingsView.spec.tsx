import {
  describe, it, expect, vi, beforeEach
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { SettingsView } from './SettingsView';
import {
  buildAdminMembership,
  buildBrandConfigHookResult,
  buildConfiguredOpenAiProvider,
  buildSettingsViewProps,
  HOSPITALITY_BRAND_CONFIG,
} from './SettingsView-fixtures';
import { buildProviderConfigHookResult } from '../ProviderHealth/ProviderHealthBanner-fixtures';
import {
  createdKeywordFixture, existingKeywordFixture
} from '../Keywords/KeywordsManager-fixtures';

vi.mock('../../hooks/useBrandConfig', () => ({ useBrandConfig: vi.fn() }));
vi.mock('../../hooks/useProviderConfig', () => ({ useProviderConfig: vi.fn() }));
vi.mock('../Keywords/KeywordsManager', () => ({ KeywordsManager: () => <div data-testid="keywords-manager">Keywords Manager</div> }));
vi.mock('../Brands/BrandConfigContent', () => ({ BrandConfigContent: () => <div data-testid="brand-config">Brand Config</div> }));
vi.mock('./AlertsConfig', () => ({
  AlertsConfig: ({ isAdmin }: { isAdmin: boolean }) => (
    <div data-testid="alerts-config">Alerts Config admin: {String(isAdmin)}</div>
  ),
}));
vi.mock('./UsersConfig', () => ({ UsersConfig: () => <div data-testid="users-config">Users Config</div> }));
vi.mock('../../hooks/useIsAdmin', () => ({ useIsAdmin: vi.fn() }));

import { useBrandConfig } from '../../hooks/useBrandConfig';
import { useProviderConfig } from '../../hooks/useProviderConfig';
import { useIsAdmin } from '../../hooks/useIsAdmin';

const mockUseBrandConfig = vi.mocked(useBrandConfig);
const mockUseProviderConfig = vi.mocked(useProviderConfig);
const mockUseIsAdmin = vi.mocked(useIsAdmin);

const NON_ADMIN_TABS = ['keywords', 'brand', 'providers', 'alerts'];
const NON_ADMIN = buildAdminMembership({ isAdmin: false });

type SettingsViewProps = ComponentProps<typeof SettingsView>;

/** Mounts the view for the given member (an admin by default) with the given props. */
function renderSettingsView(membership = buildAdminMembership(), props: Partial<SettingsViewProps> = {}) {
  mockUseIsAdmin.mockReturnValue(membership);
  render(<SettingsView {...buildSettingsViewProps(props)} />);
}

beforeEach(() => {
  mockUseBrandConfig.mockReturnValue(buildBrandConfigHookResult());
  mockUseProviderConfig.mockReturnValue(buildProviderConfigHookResult());
  mockUseIsAdmin.mockReturnValue(buildAdminMembership());
});

describe('SettingsView', () => {
  describe('tab navigation', () => {
    it.each([...NON_ADMIN_TABS, 'users'])('renders the %s tab button', (tab) => {
      renderSettingsView();

      expect(screen.getByRole('button', { name: new RegExp(tab, 'i') })).toBeInTheDocument();
    });

    it('shows keywords tab by default', () => {
      render(<SettingsView {...buildSettingsViewProps()} />);

      expect(screen.getByTestId('keywords-manager')).toBeInTheDocument();
    });

    it('switches to brand config tab when clicked', async () => {
      render(<SettingsView {...buildSettingsViewProps()} />);

      await userEvent.click(screen.getByRole('button', { name: /brand/i }));

      expect(screen.getByTestId('brand-config')).toBeInTheDocument();
    });

    it('switches to alerts config tab when clicked', async () => {
      render(<SettingsView {...buildSettingsViewProps()} />);

      await userEvent.click(screen.getByRole('button', { name: /alerts/i }));

      expect(screen.getByTestId('alerts-config')).toHaveTextContent('Alerts Config admin: true');
    });

    it('marks the alerts tab as current when alerts are selected', () => {
      render(<SettingsView {...buildSettingsViewProps({ initialTab: 'alerts' })} />);

      expect(screen.getByRole('button', { name: /alerts/i })).toHaveAttribute('aria-current', 'page');
    });

    it('switches to users tab when clicked', async () => {
      render(<SettingsView {...buildSettingsViewProps()} />);

      await userEvent.click(screen.getByRole('button', { name: /users/i }));

      expect(screen.getByTestId('users-config')).toBeInTheDocument();
    });
  });

  describe('keywords count badge', () => {
    it('shows keyword count in badge', () => {
      render(<SettingsView {...buildSettingsViewProps({ keywords: [existingKeywordFixture, createdKeywordFixture] })} />);

      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  describe('attention bubbles', () => {
    it('shows attention dots for unconfigured brand and providers', () => {
      render(<SettingsView {...buildSettingsViewProps()} />);

      expect(screen.getAllByRole('status', { name: 'Needs configuration' })).toHaveLength(2);
    });

    it('shows a keywords attention dot when no keywords exist', () => {
      render(<SettingsView {...buildSettingsViewProps({ keywords: [] })} />);

      expect(screen.getAllByRole('status', { name: 'Needs configuration' })).toHaveLength(3);
    });

    it('hides all attention dots when everything is configured', () => {
      mockUseBrandConfig.mockReturnValue(buildBrandConfigHookResult({ config: HOSPITALITY_BRAND_CONFIG }));
      mockUseProviderConfig.mockReturnValue(
        buildProviderConfigHookResult({ providers: [buildConfiguredOpenAiProvider()] })
      );

      render(<SettingsView {...buildSettingsViewProps()} />);

      expect(screen.queryByRole('status', { name: 'Needs configuration' })).not.toBeInTheDocument();
    });
  });

  describe('app version', () => {
    it('displays the deployed application version', () => {
      render(<SettingsView {...buildSettingsViewProps()} />);

      expect(screen.getByText(/^Version \d+\.\d+\.\d+$/)).toBeInTheDocument();
    });
  });

  describe('providers tab', () => {
    it('switches to providers tab when clicked', async () => {
      mockUseProviderConfig.mockReturnValue(
        buildProviderConfigHookResult({ providers: [buildConfiguredOpenAiProvider()] })
      );

      render(<SettingsView {...buildSettingsViewProps()} />);

      await userEvent.click(screen.getByRole('button', { name: /providers/i }));

      expect(screen.getByText(/AI Providers/i)).toBeInTheDocument();
    });
  });

  describe('users tab visibility', () => {
    it('hides the users tab from non-admin users', () => {
      renderSettingsView(NON_ADMIN);

      expect(screen.queryByRole('button', { name: /users/i })).not.toBeInTheDocument();
    });

    it('hides the users tab while admin membership is still loading', () => {
      renderSettingsView(buildAdminMembership({
        isAdmin: false,
        loading: true,
      }));

      expect(screen.queryByRole('button', { name: /users/i })).not.toBeInTheDocument();
    });

    it.each(NON_ADMIN_TABS)('keeps the %s tab available to non-admin users', (tab) => {
      renderSettingsView(NON_ADMIN);

      expect(screen.getByRole('button', { name: new RegExp(tab, 'i') })).toBeInTheDocument();
    });

    it('passes read-only membership to alerts for non-admin users', () => {
      renderSettingsView(NON_ADMIN, { initialTab: 'alerts' });

      expect(screen.getByTestId('alerts-config')).toHaveTextContent('Alerts Config admin: false');
    });

    it('falls back to keywords when a non-admin deep-links to the users tab', () => {
      renderSettingsView(NON_ADMIN, { initialTab: 'users' });

      expect(screen.getByTestId('keywords-manager')).toBeInTheDocument();
    });

    it('does not render user management for a non-admin deep link', () => {
      renderSettingsView(NON_ADMIN, { initialTab: 'users' });

      expect(screen.queryByTestId('users-config')).not.toBeInTheDocument();
    });

    it('honours an admin deep link straight to the users tab', () => {
      renderSettingsView(buildAdminMembership(), { initialTab: 'users' });

      expect(screen.getByTestId('users-config')).toBeInTheDocument();
    });
  });
});

describe('SettingsView admin-only provider controls', () => {
  beforeEach(() => {
    mockUseProviderConfig.mockReturnValue(
      buildProviderConfigHookResult({ providers: [buildConfiguredOpenAiProvider()] })
    );
  });

  async function renderProvidersTab(membership = buildAdminMembership()) {
    renderSettingsView(membership);
    await userEvent.click(screen.getByRole('button', { name: /providers/i }));
  }

  it('hides the provider enable toggle from non-admin users', async () => {
    await renderProvidersTab(NON_ADMIN);

    expect(screen.queryByRole('button', { name: /^Disable$/i })).not.toBeInTheDocument();
  });

  it('hides the API key button from non-admin users', async () => {
    await renderProvidersTab(NON_ADMIN);

    expect(screen.queryByRole('button', { name: /Update Key/i })).not.toBeInTheDocument();
  });

  it('still shows provider status to non-admin users', async () => {
    await renderProvidersTab(NON_ADMIN);

    expect(screen.getByText('Configured')).toBeInTheDocument();
    expect(screen.getByText('****1234')).toBeInTheDocument();
  });

  it('explains to non-admin users that changes need an administrator', async () => {
    await renderProvidersTab(NON_ADMIN);

    expect(screen.getByText(/Changing provider settings requires an administrator/i)).toBeInTheDocument();
  });

  it('shows the API key button to admin users', async () => {
    await renderProvidersTab();

    expect(screen.getByRole('button', { name: /Update Key/i })).toBeInTheDocument();
  });
});
