import {
  describe, it, expect, vi, beforeEach
} from 'vitest';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import {
  render, screen
} from '@testing-library/react';
import { publishSettingsAttention } from '../Layout/settingsAttention';
import { SettingsView } from './SettingsView';
import {
  buildAdminMembership,
  buildConfiguredOpenAiProvider,
  buildSettingsViewProps,
  HOSPITALITY_BRAND_CONFIG,
  publishedAttention,
} from './SettingsView-fixtures';
import { buildBrandConfigHookResult } from '../../test/brandConfigHookMock';
import { buildProviderConfigHookResult } from '../ProviderHealth/ProviderHealthBanner-fixtures';

vi.mock('../Keywords/KeywordsManager', () => ({ KeywordsManager: () => <div data-testid="keywords-manager">Keywords Manager</div> }));
vi.mock('../../hooks/useBrandConfig');
vi.mock('../Brands/BrandConfigContent', () => ({ BrandConfigContent: () => <div data-testid="brand-config">Brand Config</div> }));
vi.mock('../../hooks/useProviderConfig');
vi.mock('../AiAssistants', () => ({ AiAssistantsView: () => <div data-testid="ai-assistants-guide">AI Assistants Guide</div> }));
vi.mock('../../hooks/useIsAdmin');
vi.mock('./AlertsConfig', () => ({
  AlertsConfig: ({ isAdmin }: { isAdmin: boolean }) => (
    <div data-testid="alerts-config">Alerts Config admin: {String(isAdmin)}</div>
  ),
}));
vi.mock('./BedrockModelsConfig', () => ({ BedrockModelsConfig: () => <div data-testid="bedrock-models-config">Bedrock Models Config</div> }));
vi.mock('./MarketsConfig', () => ({
  MarketsConfig: ({ isAdmin }: { isAdmin: boolean }) => (
    <div data-testid="markets-config">Markets Config admin: {String(isAdmin)}</div>
  ),
}));
vi.mock('./UsersConfig', () => ({ UsersConfig: () => <div data-testid="users-config">Users Config</div> }));

import { useBrandConfig } from '../../hooks/useBrandConfig';
import { useProviderConfig } from '../../hooks/useProviderConfig';
import { useIsAdmin } from '../../hooks/useIsAdmin';

const mockUseBrandConfig = vi.mocked(useBrandConfig);
const mockUseProviderConfig = vi.mocked(useProviderConfig);
const mockUseIsAdmin = vi.mocked(useIsAdmin);

const NON_ADMIN = buildAdminMembership({ isAdmin: false });
/** Admin-only sections: name, link name, URL and the test id of their (mocked) content. */
const ADMIN_SECTIONS = [
  ['users', /^users/i, '/settings/users', 'users-config'],
  ['bedrock models', /^bedrock models/i, '/settings/bedrock-models', 'bedrock-models-config'],
] as const;

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

function mockConfiguredProviders() {
  mockUseProviderConfig.mockReturnValue(
    buildProviderConfigHookResult({ providers: [buildConfiguredOpenAiProvider()] })
  );
}

beforeEach(() => {
  publishSettingsAttention([]);
  mockUseBrandConfig.mockReturnValue(buildBrandConfigHookResult());
  mockUseProviderConfig.mockReturnValue(buildProviderConfigHookResult());
  mockUseIsAdmin.mockReturnValue(buildAdminMembership());
});

describe('SettingsView', () => {
  describe('section from the URL', () => {
    it('shows keywords section by default', () => {
      renderSettingsView();

      expect(screen.getByTestId('keywords-manager')).toBeInTheDocument();
    });

    it.each<[string, string]>([
      ['/settings/brand', 'brand-config'],
      ['/settings/ai-assistants', 'ai-assistants-guide'],
      ...ADMIN_SECTIONS.map(([, , path, testId]): [string, string] => [path, testId]),
    ])('opens %s for an admin as the section in the URL', (path, testId) => {
      renderSettingsView(path);

      expect(screen.getByTestId(testId)).toBeInTheDocument();
    });

    it('falls back to keywords for an unknown section slug', () => {
      renderSettingsView('/settings/nonsense');

      expect(screen.getByTestId('keywords-manager')).toBeInTheDocument();
    });

    it('passes admin membership to alerts for admins', () => {
      renderSettingsView('/settings/alerts');

      expect(screen.getByTestId('alerts-config')).toHaveTextContent('Alerts Config admin: true');
    });

    it('opens the markets section read-only for non-admin users', () => {
      renderSettingsView('/settings/markets', {}, NON_ADMIN);

      expect(screen.getByTestId('markets-config')).toHaveTextContent('Markets Config admin: false');
    });

    it('draws no section menu of its own (the sidebar lists the sections)', () => {
      renderSettingsView();

      expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    });
  });

  describe('setup the sidebar flags', () => {
    it('publishes brand tracking and AI providers while neither is set up', () => {
      renderSettingsView();

      expect(publishedAttention()).toStrictEqual(['brand-config', 'providers']);
    });

    it('publishes nothing once the brand and a provider are set up', () => {
      mockUseBrandConfig.mockReturnValue(buildBrandConfigHookResult({ config: HOSPITALITY_BRAND_CONFIG }));
      mockConfiguredProviders();

      renderSettingsView();

      expect(publishedAttention()).toStrictEqual([]);
    });

    it('publishes nothing while the brand config and providers load', () => {
      mockUseBrandConfig.mockReturnValue(buildBrandConfigHookResult({ loading: true }));
      mockUseProviderConfig.mockReturnValue(buildProviderConfigHookResult({ loading: true }));

      renderSettingsView();

      expect(publishedAttention()).toStrictEqual([]);
    });
  });

  describe('app version', () => {
    it('displays the deployed application version', () => {
      renderSettingsView();

      expect(screen.getByText(/^Version \d+\.\d+\.\d+$/)).toBeInTheDocument();
    });
  });

  describe('providers section', () => {
    it('shows the providers of the providers URL', () => {
      mockConfiguredProviders();

      renderSettingsView('/settings/providers');

      expect(screen.getByText('Configured')).toBeInTheDocument();
    });
  });

  describe('admin-only sections', () => {
    const MEMBERSHIP_LOADING = buildAdminMembership({
      isAdmin: false,
      loading: true,
    });

    it('passes read-only membership to alerts for non-admin users', () => {
      renderSettingsView('/settings/alerts', {}, NON_ADMIN);

      expect(screen.getByTestId('alerts-config')).toHaveTextContent('Alerts Config admin: false');
    });

    it.each(ADMIN_SECTIONS)('sends a non-admin who opens the %s URL to keywords', (_section, _link, path) => {
      renderSettingsView(path, {}, NON_ADMIN);

      expect(screen.getByTestId('keywords-manager')).toBeInTheDocument();
    });

    it.each(ADMIN_SECTIONS)('does not render the %s section for a non-admin on its URL', (_section, _link, path, testId) => {
      renderSettingsView(path, {}, NON_ADMIN);

      expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
    });

    it.each(ADMIN_SECTIONS)('shows a placeholder on the %s URL while membership is confirmed', (_section, _link, path) => {
      renderSettingsView(path, {}, MEMBERSHIP_LOADING);

      expect(screen.getByText('Checking access')).toBeInTheDocument();
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
