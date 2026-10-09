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
vi.mock('../AiAssistants', () => ({ AiAssistantsView: () => <div data-testid="ai-assistants-guide">AI Assistants Guide</div> }));
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
vi.mock('../../hooks/useIsAdmin', () => ({ useIsAdmin: vi.fn() }));

import { useBrandConfig } from '../../hooks/useBrandConfig';
import { useProviderConfig } from '../../hooks/useProviderConfig';
import { useIsAdmin } from '../../hooks/useIsAdmin';

const mockUseBrandConfig = vi.mocked(useBrandConfig);
const mockUseProviderConfig = vi.mocked(useProviderConfig);
const mockUseIsAdmin = vi.mocked(useIsAdmin);

const NON_ADMIN_SECTIONS = ['keywords', 'markets', 'brand tracking', 'personas', 'ai providers', 'alerts', 'ai assistants'];
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

/** The Settings nav link whose accessible name contains `section` (case-insensitive). */
function getSectionLinkElement(section: string) {
  return screen.getByRole('link', { name: new RegExp(section, 'i') });
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
      ['markets', '/settings/markets'],
      ['brand tracking', '/settings/brand'],
      ['personas', '/settings/personas'],
      ['ai providers', '/settings/providers'],
      ['alerts', '/settings/alerts'],
      ['users', '/settings/users'],
      ['bedrock models', '/settings/bedrock-models'],
      ['ai assistants', '/settings/ai-assistants'],
    ])('links the %s entry to %s', (section, href) => {
      renderSettingsView();

      expect(getSectionLinkElement(section)).toHaveAttribute('href', href);
    });

    it.each([
      ['brand tracking', 'text-violet-500'],
      ['markets', 'text-cyan-500'],
      ['ai assistants', 'text-indigo-500'],
    ])('tints the %s icon with its accent %s', (section, tone) => {
      renderSettingsView();

      expect(getSectionLinkElement(section).querySelector('svg')).toHaveClass(tone);
    });

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
    it('opens the markets section read-only for non-admin users', () => {
      renderSettingsView('/settings/markets', {}, NON_ADMIN);

      expect(screen.getByTestId('markets-config')).toHaveTextContent('Markets Config admin: false');
    });

    it('shows the market count under the markets link', () => {
      renderSettingsView();

      expect(getSectionLinkElement('markets')).toHaveTextContent('Countries and languages');
    });
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

  describe('admin-only section visibility', () => {
    const MEMBERSHIP_LOADING = buildAdminMembership({
      isAdmin: false,
      loading: true,
    });
    const HIDDEN_LINKS = ADMIN_SECTIONS.flatMap(([section, link]) => [
      [section, 'from non-admin users', link, NON_ADMIN],
      [section, 'while admin membership is still loading', link, MEMBERSHIP_LOADING],
    ] as const);

    it.each(HIDDEN_LINKS)('hides the %s link %s', (_section, _condition, link, membership) => {
      renderSettingsView('/settings', {}, membership);

      expect(screen.queryByRole('link', { name: link })).not.toBeInTheDocument();
    });

    it('lists Bedrock models under Processing for admins', () => {
      renderSettingsView();

      expect(screen.getByText('Processing')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /bedrock models/i })).toHaveTextContent('Claude on Amazon Bedrock');
    });

    it('drops the Processing group for non-admin users', () => {
      renderSettingsView('/settings', {}, NON_ADMIN);

      expect(screen.queryByText('Processing')).not.toBeInTheDocument();
    });

    it.each(NON_ADMIN_SECTIONS)('keeps the %s section available to non-admin users', (section) => {
      renderSettingsView('/settings', {}, NON_ADMIN);

      expect(getSectionLinkElement(section)).toBeInTheDocument();
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
