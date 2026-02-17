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

import { useBrandConfig } from '../../hooks/useBrandConfig';
import { useProviderConfig } from '../../hooks/useProviderConfig';

const mockUseBrandConfig = useBrandConfig as ReturnType<typeof vi.fn>;
const mockUseProviderConfig = useProviderConfig as ReturnType<typeof vi.fn>;

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
});
