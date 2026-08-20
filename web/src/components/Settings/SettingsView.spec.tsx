import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsView } from './SettingsView';

vi.mock('../../hooks/useBrandConfig', () => ({useBrandConfig: vi.fn(),}));

vi.mock('../../hooks/useProviderConfig', () => ({useProviderConfig: vi.fn(),}));

vi.mock('../Keywords/KeywordsManager', () => ({KeywordsManager: () => <div data-testid="keywords-manager">Keywords Manager</div>,}));

vi.mock('../Brands/BrandConfigContent', () => ({BrandConfigContent: () => <div data-testid="brand-config">Brand Config</div>,}));

vi.mock('./UsersConfig', () => ({UsersConfig: () => <div data-testid="users-config">Users Config</div>,}));

vi.mock('../../hooks/useIsAdmin', () => ({useIsAdmin: vi.fn(),}));

import { useBrandConfig } from '../../hooks/useBrandConfig';
import { useProviderConfig } from '../../hooks/useProviderConfig';
import { useIsAdmin } from '../../hooks/useIsAdmin';

const mockUseBrandConfig = useBrandConfig as ReturnType<typeof vi.fn>;
const mockUseProviderConfig = useProviderConfig as ReturnType<typeof vi.fn>;
const mockUseIsAdmin = useIsAdmin as ReturnType<typeof vi.fn>;

function buildProps(overrides = {}) {
  return {
    keywords: [{
      id: '1',
      keyword: 'hotels',
      created_at: '2024-01-01T00:00:00Z' 
    }],
    setKeywords: vi.fn(),
    ...overrides,
  };
}

describe('SettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBrandConfig.mockReturnValue({
      config: null,
      presets: {},
      loading: false,
      saveConfig: vi.fn(),
      expandAllBrands: vi.fn(),
      findCompetitors: vi.fn(),
    });
    mockUseProviderConfig.mockReturnValue({
      providers: [],
      loading: false,
      updateProvider: vi.fn(),
      refreshProviders: vi.fn(),
    });
    mockUseIsAdmin.mockReturnValue({
      isAdmin: true,
      loading: false,
    });
  });

  describe('tab navigation', () => {
    it('renders all tab buttons', () => {
      render(<SettingsView {...buildProps()} />);

      expect(screen.getByRole('button', { name: /keywords/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /brand/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /providers/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /users/i })).toBeInTheDocument();
    });

    it('shows keywords tab by default', () => {
      render(<SettingsView {...buildProps()} />);

      expect(screen.getByTestId('keywords-manager')).toBeInTheDocument();
    });

    it('switches to brand config tab when clicked', async () => {
      render(<SettingsView {...buildProps()} />);

      await userEvent.click(screen.getByRole('button', { name: /brand/i }));

      expect(screen.getByTestId('brand-config')).toBeInTheDocument();
    });

    it('switches to users tab when clicked', async () => {
      render(<SettingsView {...buildProps()} />);

      await userEvent.click(screen.getByRole('button', { name: /users/i }));

      expect(screen.getByTestId('users-config')).toBeInTheDocument();
    });
  });

  describe('keywords count badge', () => {
    it('shows keyword count in badge', () => {
      render(<SettingsView {...buildProps({
        keywords: [
          { keyword: 'hotels' },
          { keyword: 'resorts' }
        ] 
      })} />);

      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  describe('attention bubbles', () => {
    it('shows attention dots for unconfigured brand and providers', () => {
      render(<SettingsView {...buildProps()} />);

      expect(screen.getAllByRole('status', { name: 'Needs configuration' })).toHaveLength(2);
    });

    it('shows a keywords attention dot when no keywords exist', () => {
      render(<SettingsView {...buildProps({ keywords: [] })} />);

      expect(screen.getAllByRole('status', { name: 'Needs configuration' })).toHaveLength(3);
    });

    it('hides all attention dots when everything is configured', () => {
      mockUseBrandConfig.mockReturnValue({
        config: {
          industry: 'hospitality',
          tracked_brands: {
            first_party: ['MyHotel'],
            competitors: [],
          },
        },
        presets: {},
        loading: false,
        saveConfig: vi.fn(),
        expandAllBrands: vi.fn(),
        findCompetitors: vi.fn(),
      });
      mockUseProviderConfig.mockReturnValue({
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            description: 'GPT model',
            model: 'gpt',
            docs_url: 'https://openai.com',
            enabled: true,
            configured: true,
            masked_key: '****1234',
            last_updated: null,
          },
        ],
        loading: false,
        updateProvider: vi.fn(),
        refreshProviders: vi.fn(),
      });

      render(<SettingsView {...buildProps()} />);

      expect(screen.queryByRole('status', { name: 'Needs configuration' })).not.toBeInTheDocument();
    });
  });

  describe('app version', () => {
    it('displays the deployed application version', () => {
      render(<SettingsView {...buildProps()} />);

      expect(screen.getByText(/^Version \d+\.\d+\.\d+$/)).toBeInTheDocument();
    });
  });

  describe('providers tab', () => {
    it('switches to providers tab when clicked', async () => {
      mockUseProviderConfig.mockReturnValue({
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            description: 'GPT-4 model',
            model: 'gpt-4',
            docs_url: 'https://openai.com',
            enabled: true,
            configured: true,
            masked_key: '****1234',
            last_updated: null,
          },
        ],
        loading: false,
        updateProvider: vi.fn(),
        refreshProviders: vi.fn(),
      });

      render(<SettingsView {...buildProps()} />);

      await userEvent.click(screen.getByRole('button', { name: /providers/i }));

      // Providers tab content is rendered inline, not mocked
      expect(screen.getByText(/AI Providers/i)).toBeInTheDocument();
    });
  });

  describe('users tab visibility', () => {
    /**
     * The client-side half of AUDIT-2026-08-19 §0. Every route behind this tab
     * is gated by `require_group('Admin')` server-side, so hiding it is a
     * usability fix, not the security control — a non-admin who forces the tab
     * open gets a 403 from every action inside it.
     */

    it('hides the users tab from non-admin users', () => {
      mockUseIsAdmin.mockReturnValue({
        isAdmin: false,
        loading: false,
      });

      render(<SettingsView {...buildProps()} />);

      expect(screen.queryByRole('button', { name: /users/i })).not.toBeInTheDocument();
    });

    it('hides the users tab while admin membership is still loading', () => {
      /** Avoids flashing the tab in before the session resolves. */
      mockUseIsAdmin.mockReturnValue({
        isAdmin: false,
        loading: true,
      });

      render(<SettingsView {...buildProps()} />);

      expect(screen.queryByRole('button', { name: /users/i })).not.toBeInTheDocument();
    });

    it('keeps the other four tabs available to non-admin users', () => {
      mockUseIsAdmin.mockReturnValue({
        isAdmin: false,
        loading: false,
      });

      render(<SettingsView {...buildProps()} />);

      expect(screen.getByRole('button', { name: /keywords/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /brand/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /providers/i })).toBeInTheDocument();
    });

    it('falls back to keywords when a non-admin deep-links to the users tab', () => {
      /**
       * `initialTab` accepts the full SettingsTab union, so without this reset
       * the tab bar would render with nothing selected and an empty panel.
       */
      mockUseIsAdmin.mockReturnValue({
        isAdmin: false,
        loading: false,
      });

      render(<SettingsView {...buildProps({ initialTab: 'users' })} />);

      expect(screen.getByTestId('keywords-manager')).toBeInTheDocument();
    });

    it('does not render user management for a non-admin deep link', () => {
      mockUseIsAdmin.mockReturnValue({
        isAdmin: false,
        loading: false,
      });

      render(<SettingsView {...buildProps({ initialTab: 'users' })} />);

      expect(screen.queryByTestId('users-config')).not.toBeInTheDocument();
    });

    it('honours an admin deep link straight to the users tab', () => {
      render(<SettingsView {...buildProps({ initialTab: 'users' })} />);

      expect(screen.getByTestId('users-config')).toBeInTheDocument();
    });
  });
});


describe('SettingsView admin-only provider controls', () => {
  /**
   * PUT /api/providers/{id} writes Secrets Manager through a role with
   * prefix-wide access to every provider key (AUDIT-2026-08-19 §0.3). The cards
   * stay readable — only the controls that would 403 are withheld.
   */

  const configuredProvider = {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4 model',
    model: 'gpt-4',
    docs_url: 'https://openai.com',
    enabled: true,
    configured: true,
    masked_key: '****1234',
    last_updated: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBrandConfig.mockReturnValue({
      config: null,
      presets: {},
      loading: false,
      saveConfig: vi.fn(),
      expandAllBrands: vi.fn(),
      findCompetitors: vi.fn(),
    });
    mockUseProviderConfig.mockReturnValue({
      providers: [configuredProvider],
      loading: false,
      updateProvider: vi.fn(),
      refreshProviders: vi.fn(),
    });
    mockUseIsAdmin.mockReturnValue({
      isAdmin: true,
      loading: false,
    });
  });

  async function openProvidersTab() {
    await userEvent.click(screen.getByRole('button', { name: /providers/i }));
  }

  it('hides the provider enable toggle from non-admin users', async () => {
    mockUseIsAdmin.mockReturnValue({
      isAdmin: false,
      loading: false,
    });
    render(<SettingsView {...buildProps()} />);

    await openProvidersTab();

    expect(screen.queryByRole('button', { name: /^Disable$/i })).not.toBeInTheDocument();
  });

  it('hides the API key button from non-admin users', async () => {
    mockUseIsAdmin.mockReturnValue({
      isAdmin: false,
      loading: false,
    });
    render(<SettingsView {...buildProps()} />);

    await openProvidersTab();

    expect(screen.queryByRole('button', { name: /Update Key/i })).not.toBeInTheDocument();
  });

  it('still shows provider status to non-admin users', async () => {
    mockUseIsAdmin.mockReturnValue({
      isAdmin: false,
      loading: false,
    });
    render(<SettingsView {...buildProps()} />);

    await openProvidersTab();

    expect(screen.getByText('Configured')).toBeInTheDocument();
    expect(screen.getByText('****1234')).toBeInTheDocument();
  });

  it('explains to non-admin users that changes need an administrator', async () => {
    mockUseIsAdmin.mockReturnValue({
      isAdmin: false,
      loading: false,
    });
    render(<SettingsView {...buildProps()} />);

    await openProvidersTab();

    expect(screen.getByText(/Changing provider settings requires an administrator/i)).toBeInTheDocument();
  });

  it('shows the API key button to admin users', async () => {
    /** Guards the hidden-control assertions from passing on a renamed label. */
    render(<SettingsView {...buildProps()} />);

    await openProvidersTab();

    expect(screen.getByRole('button', { name: /Update Key/i })).toBeInTheDocument();
  });
});
