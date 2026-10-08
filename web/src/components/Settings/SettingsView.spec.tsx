import {
  describe, it, expect, vi, beforeEach
} from 'vitest';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsView } from './SettingsView';
import {
  buildAdminMembership,
  buildConfiguredOpenAiProvider,
  buildSettingsViewProps,
  HOSPITALITY_BRAND_CONFIG,
} from './SettingsView-fixtures';
import { buildBrandConfigHookResult } from '../../test/brandConfigHookMock';
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

const NON_ADMIN_SECTIONS = ['keywords', 'brand tracking', 'personas', 'ai providers', 'alerts'];
const NON_ADMIN = buildAdminMembership({ isAdmin: false });

type SettingsViewProps = ComponentProps<typeof SettingsView>;

/** Mounts the view at a settings URL for the given member (an admin by default). */
function renderSettingsView(
  path = '/settings',
  props: Partial<SettingsViewProps> = {},
  membership = buildAdminMembership(),
) {
  mockUseIsAdmin.mockReturnValue(membership);
  render(
    <MemoryRouter initialEntries={[path]}>
      <SettingsView {...buildSettingsViewProps(props)} />
    </MemoryRouter>
  );
}

async function renderAndOpenSection(sectionName: RegExp, membership = buildAdminMembership()) {
  renderSettingsView('/settings', {}, membership);
  await userEvent.click(screen.getByRole('link', { name: sectionName }));
}

function mockConfiguredProviders() {
  mockUseProviderConfig.mockReturnValue(
    buildProviderConfigHookResult({ providers: [buildConfiguredOpenAiProvider()] })
  );
}

beforeEach(() => {
  mockUseBrandConfig.mockReturnValue(buildBrandConfigHookResult());
  mockUseProviderConfig.mockReturnValue(buildProviderConfigHookResult());
  mockUseIsAdmin.mockReturnValue(buildAdminMembership());
});

describe('SettingsView', () => {
  describe('section navigation', () => {
    it.each([
      ['keywords', '/settings/keywords'],
      ['brand tracking', '/settings/brand'],
      ['personas', '/settings/personas'],
      ['ai providers', '/settings/providers'],
      ['alerts', '/settings/alerts'],
      ['users', '/settings/users'],
      ['ai assistants', '/ai-assistants'],
    ])('links the %s entry to %s', (section, href) => {
      renderSettingsView();

      expect(screen.getByRole('link', { name: new RegExp(section, 'i') })).toHaveAttribute('href', href);
    });

    it('shows keywords section by default', () => {
      renderSettingsView();

      expect(screen.getByTestId('keywords-manager')).toBeInTheDocument();
    });

    it('opens the section named in the URL', () => {
      renderSettingsView('/settings/brand');

      expect(screen.getByTestId('brand-config')).toBeInTheDocument();
    });

    it('falls back to keywords for an unknown section slug', () => {
      renderSettingsView('/settings/nonsense');

      expect(screen.getByTestId('keywords-manager')).toBeInTheDocument();
    });

    it('switches to brand config section when clicked', async () => {
      await renderAndOpenSection(/brand tracking/i);

      expect(screen.getByTestId('brand-config')).toBeInTheDocument();
    });

    it('switches to alerts config section when clicked', async () => {
      await renderAndOpenSection(/alerts/i);

      expect(screen.getByTestId('alerts-config')).toHaveTextContent('Alerts Config admin: true');
    });

    it('marks the alerts link as current when alerts are open', () => {
      renderSettingsView('/settings/alerts');

      expect(screen.getByRole('link', { name: /alerts/i })).toHaveAttribute('aria-current', 'page');
    });

    it('switches to users section when clicked', async () => {
      await renderAndOpenSection(/users/i);

      expect(screen.getByTestId('users-config')).toBeInTheDocument();
    });
  });

  describe('section captions', () => {
    it('shows the keyword count under the keywords link', () => {
      renderSettingsView('/settings', { keywords: [existingKeywordFixture, createdKeywordFixture] });

      expect(screen.getByRole('link', { name: /keywords/i })).toHaveTextContent('2 keywords');
    });

    it('shows the tracked industry once the brand config has loaded', () => {
      mockUseBrandConfig.mockReturnValue(buildBrandConfigHookResult({ config: HOSPITALITY_BRAND_CONFIG }));

      renderSettingsView();

      expect(screen.getByRole('link', { name: /brand tracking/i })).toHaveTextContent('hospitality');
    });

    it('holds a placeholder instead of the default industry while the brand config loads', () => {
      mockUseBrandConfig.mockReturnValue(buildBrandConfigHookResult({ loading: true }));

      renderSettingsView();

      expect(screen.getByRole('link', { name: /brand tracking/i }).querySelector('.skeleton')).not.toBeNull();
    });

    it('shows the enabled provider count once providers have loaded', () => {
      mockConfiguredProviders();

      renderSettingsView();

      expect(screen.getByRole('link', { name: /ai providers/i })).toHaveTextContent('1 of 1 enabled');
    });

    it('holds a placeholder instead of 0 of 0 while providers load', () => {
      mockUseProviderConfig.mockReturnValue(buildProviderConfigHookResult({ loading: true }));

      renderSettingsView();

      expect(screen.getByRole('link', { name: /ai providers/i })).not.toHaveTextContent('0 of 0');
    });
  });

  describe('attention bubbles', () => {
    it('shows attention dots for unconfigured brand and providers', () => {
      renderSettingsView();

      expect(screen.getAllByRole('status', { name: 'Needs configuration' })).toHaveLength(2);
    });

    it('shows a keywords attention dot when no keywords exist', () => {
      renderSettingsView('/settings', { keywords: [] });

      expect(screen.getAllByRole('status', { name: 'Needs configuration' })).toHaveLength(3);
    });

    it('hides all attention dots when everything is configured', () => {
      mockUseBrandConfig.mockReturnValue(buildBrandConfigHookResult({ config: HOSPITALITY_BRAND_CONFIG }));
      mockConfiguredProviders();

      renderSettingsView();

      expect(screen.queryByRole('status', { name: 'Needs configuration' })).not.toBeInTheDocument();
    });
  });

  describe('app version', () => {
    it('displays the deployed application version', () => {
      renderSettingsView();

      expect(screen.getByText(/^Version \d+\.\d+\.\d+$/)).toBeInTheDocument();
    });
  });

  describe('providers section', () => {
    it('switches to providers section when clicked', async () => {
      mockConfiguredProviders();

      await renderAndOpenSection(/ai providers/i);

      expect(screen.getByText('Configured')).toBeInTheDocument();
    });
  });

  describe('users section visibility', () => {
    it.each([
      ['from non-admin users', NON_ADMIN],
      ['while admin membership is still loading', buildAdminMembership({
        isAdmin: false,
        loading: true,
      })],
    ])('hides the users link %s', (_condition, membership) => {
      renderSettingsView('/settings', {}, membership);

      expect(screen.queryByRole('link', { name: /^users/i })).not.toBeInTheDocument();
    });

    it.each(NON_ADMIN_SECTIONS)('keeps the %s section available to non-admin users', (section) => {
      renderSettingsView('/settings', {}, NON_ADMIN);

      expect(screen.getByRole('link', { name: new RegExp(section, 'i') })).toBeInTheDocument();
    });

    it('passes read-only membership to alerts for non-admin users', () => {
      renderSettingsView('/settings/alerts', {}, NON_ADMIN);

      expect(screen.getByTestId('alerts-config')).toHaveTextContent('Alerts Config admin: false');
    });

    it('sends a non-admin who opens the users URL to keywords', () => {
      renderSettingsView('/settings/users', {}, NON_ADMIN);

      expect(screen.getByTestId('keywords-manager')).toBeInTheDocument();
    });

    it('does not render user management for a non-admin on the users URL', () => {
      renderSettingsView('/settings/users', {}, NON_ADMIN);

      expect(screen.queryByTestId('users-config')).not.toBeInTheDocument();
    });

    it('shows a placeholder on the users URL while membership is confirmed', () => {
      renderSettingsView('/settings/users', {}, buildAdminMembership({
        isAdmin: false,
        loading: true,
      }));

      expect(screen.getByText('Checking access')).toBeInTheDocument();
    });

    it('honours an admin link straight to the users section', () => {
      renderSettingsView('/settings/users');

      expect(screen.getByTestId('users-config')).toBeInTheDocument();
    });
  });
});

describe('SettingsView admin-only provider controls', () => {
  beforeEach(() => {
    mockConfiguredProviders();
  });

  function renderProvidersSection(membership = buildAdminMembership()) {
    renderSettingsView('/settings/providers', {}, membership);
  }

  it('hides the provider enable toggle from non-admin users', () => {
    renderProvidersSection(NON_ADMIN);

    expect(screen.queryByRole('button', { name: /^Disable$/i })).not.toBeInTheDocument();
  });

  it('hides the API key button from non-admin users', () => {
    renderProvidersSection(NON_ADMIN);

    expect(screen.queryByRole('button', { name: /Update Key/i })).not.toBeInTheDocument();
  });

  it('still shows provider status to non-admin users', () => {
    renderProvidersSection(NON_ADMIN);

    expect(screen.getByText('Configured')).toBeInTheDocument();
    expect(screen.getByText('****1234')).toBeInTheDocument();
  });

  it('explains to non-admin users that changes need an administrator', () => {
    renderProvidersSection(NON_ADMIN);

    expect(screen.getByText(/Changing provider settings requires an administrator/i)).toBeInTheDocument();
  });

  it('shows the API key button to admin users', () => {
    renderProvidersSection();

    expect(screen.getByRole('button', { name: /Update Key/i })).toBeInTheDocument();
  });
});
