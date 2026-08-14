import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  render, screen, fireEvent 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  OnboardingModal, ONBOARDING_DISMISSED_STORAGE_KEY, ONBOARDING_COMPLETE_STORAGE_KEY 
} from './OnboardingModal';

vi.mock('../../hooks/useOnboardingStatus', () => ({useOnboardingStatus: vi.fn(),}));

import { useOnboardingStatus } from '../../hooks/useOnboardingStatus';

const mockUseOnboardingStatus = useOnboardingStatus as ReturnType<typeof vi.fn>;

const localStorageMock: {
  store: Record<string, string>;
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
} = {
  store: {},
  getItem: vi.fn((key: string): string | null => {
    const value = localStorageMock.store[key];
    return value ?? null;
  }),
  setItem: vi.fn((key: string, value: string): void => {
    localStorageMock.store[key] = value;
  }),
};

function buildProps(overrides = {}) {
  return {
    keywordsCount: 0,
    hasRunAnalysis: false,
    setActiveTab: vi.fn(),
    onNavigateToSettings: vi.fn(),
    ...overrides,
  };
}

function buildStatus(overrides = {}) {
  return {
    providersConfigured: false,
    brandConfigured: false,
    scheduleConfigured: false,
    personasConfigured: false,
    ...overrides,
  };
}

describe('OnboardingModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(localStorageMock.store).forEach((key) => delete localStorageMock.store[key]);
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });
    mockUseOnboardingStatus.mockReturnValue({
      status: buildStatus(),
      loading: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('visibility', () => {
    it('opens the modal when setup is incomplete', () => {
      render(<OnboardingModal {...buildProps()} />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Get started with Citation Analysis')).toBeInTheDocument();
    });

    it('renders nothing while setup status is loading', () => {
      mockUseOnboardingStatus.mockReturnValue({
        status: null,
        loading: true,
      });

      const { container } = render(<OnboardingModal {...buildProps()} />);

      expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when previously skipped', () => {
      localStorageMock.store[ONBOARDING_DISMISSED_STORAGE_KEY] = 'true';

      const { container } = render(<OnboardingModal {...buildProps()} />);

      expect(container).toBeEmptyDOMElement();
    });

    it('disables status fetching when previously skipped', () => {
      localStorageMock.store[ONBOARDING_DISMISSED_STORAGE_KEY] = 'true';

      render(<OnboardingModal {...buildProps()} />);

      expect(mockUseOnboardingStatus).toHaveBeenCalledWith(false);
    });

    it('disables status fetching when setup was previously completed', () => {
      localStorageMock.store[ONBOARDING_COMPLETE_STORAGE_KEY] = 'true';

      const { container } = render(<OnboardingModal {...buildProps()} />);

      expect(mockUseOnboardingStatus).toHaveBeenCalledWith(false);
      expect(container).toBeEmptyDOMElement();
    });

    it('stays open when only optional steps are incomplete and a required step is pending', () => {
      mockUseOnboardingStatus.mockReturnValue({
        status: buildStatus({
          providersConfigured: true,
          brandConfigured: true,
        }),
        loading: false,
      });

      render(<OnboardingModal {...buildProps({ keywordsCount: 3 })} />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('completion caching', () => {
    it('persists the completion flag when all required steps are complete', () => {
      mockUseOnboardingStatus.mockReturnValue({
        status: buildStatus({
          providersConfigured: true,
          brandConfigured: true,
        }),
        loading: false,
      });

      render(
        <OnboardingModal {...buildProps({
          keywordsCount: 3,
          hasRunAnalysis: true,
        })} />
      );

      expect(localStorageMock.setItem).toHaveBeenCalledWith(ONBOARDING_COMPLETE_STORAGE_KEY, 'true');
    });

    it('renders nothing when all required steps are complete', () => {
      mockUseOnboardingStatus.mockReturnValue({
        status: buildStatus({
          providersConfigured: true,
          brandConfigured: true,
        }),
        loading: false,
      });

      const { container } = render(
        <OnboardingModal {...buildProps({
          keywordsCount: 3,
          hasRunAnalysis: true,
        })} />
      );

      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('step content', () => {
    it('lists the four required steps by title', () => {
      render(<OnboardingModal {...buildProps()} />);

      expect(screen.getByText('Add AI provider API keys')).toBeInTheDocument();
      expect(screen.getByText('Add keywords to track')).toBeInTheDocument();
      expect(screen.getByText('Set up brand tracking')).toBeInTheDocument();
      expect(screen.getByText('Run your first analysis')).toBeInTheDocument();
    });

    it('lists the optional schedule and persona steps', () => {
      render(<OnboardingModal {...buildProps()} />);

      expect(screen.getByText('Automate runs with a schedule')).toBeInTheDocument();
      expect(screen.getByText('Define user personas')).toBeInTheDocument();
      expect(screen.getAllByText('Optional')).toHaveLength(2);
    });

    it('counts configured signals in the progress badge', () => {
      mockUseOnboardingStatus.mockReturnValue({
        status: buildStatus({ providersConfigured: true }),
        loading: false,
      });

      render(<OnboardingModal {...buildProps({ keywordsCount: 2 })} />);

      expect(screen.getByText('2 of 4 required steps done')).toBeInTheDocument();
    });

    it('hides the action button for completed steps', () => {
      mockUseOnboardingStatus.mockReturnValue({
        status: buildStatus({ providersConfigured: true }),
        loading: false,
      });

      render(<OnboardingModal {...buildProps()} />);

      expect(screen.queryByRole('button', { name: 'Configure providers' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add keywords' })).toBeInTheDocument();
    });
  });

  describe('step navigation', () => {
    it('navigates to provider settings when the provider action is clicked', async () => {
      const props = buildProps();
      render(<OnboardingModal {...props} />);

      await userEvent.click(screen.getByRole('button', { name: 'Configure providers' }));

      expect(props.onNavigateToSettings).toHaveBeenCalledWith('providers');
    });

    it('navigates to persona settings when the persona action is clicked', async () => {
      const props = buildProps();
      render(<OnboardingModal {...props} />);

      await userEvent.click(screen.getByRole('button', { name: 'Add personas' }));

      expect(props.onNavigateToSettings).toHaveBeenCalledWith('query-prompts');
    });

    it('navigates to the schedule tab when the schedule action is clicked', async () => {
      const props = buildProps();
      render(<OnboardingModal {...props} />);

      await userEvent.click(screen.getByRole('button', { name: 'Create schedule' }));

      expect(props.setActiveTab).toHaveBeenCalledWith('schedule');
    });

    it('closes the modal for the session when a step action is clicked', async () => {
      render(<OnboardingModal {...buildProps()} />);

      await userEvent.click(screen.getByRole('button', { name: 'Run analysis' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(localStorageMock.setItem).not.toHaveBeenCalledWith(ONBOARDING_DISMISSED_STORAGE_KEY, 'true');
    });
  });

  describe('skip and close', () => {
    it('persists the skip flag when set up later is clicked', async () => {
      render(<OnboardingModal {...buildProps()} />);

      await userEvent.click(screen.getByRole('button', { name: 'Set up later' }));

      expect(localStorageMock.setItem).toHaveBeenCalledWith(ONBOARDING_DISMISSED_STORAGE_KEY, 'true');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('closes for the session without persisting when Escape is pressed', () => {
      render(<OnboardingModal {...buildProps()} />);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(localStorageMock.setItem).not.toHaveBeenCalledWith(ONBOARDING_DISMISSED_STORAGE_KEY, 'true');
    });
  });
});
