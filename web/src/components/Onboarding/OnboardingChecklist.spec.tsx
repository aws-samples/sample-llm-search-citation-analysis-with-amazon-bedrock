import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  OnboardingChecklist, ONBOARDING_DISMISSED_STORAGE_KEY 
} from './OnboardingChecklist';

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
    ...overrides,
  };
}

describe('OnboardingChecklist', () => {
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
    it('renders the checklist when setup is incomplete', () => {
      render(<OnboardingChecklist {...buildProps()} />);

      expect(screen.getByText('Get started with Citation Analysis')).toBeInTheDocument();
    });

    it('renders nothing when previously dismissed', () => {
      localStorageMock.store[ONBOARDING_DISMISSED_STORAGE_KEY] = 'true';

      const { container } = render(<OnboardingChecklist {...buildProps()} />);

      expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing while setup status is loading', () => {
      mockUseOnboardingStatus.mockReturnValue({
        status: null,
        loading: true,
      });

      const { container } = render(<OnboardingChecklist {...buildProps()} />);

      expect(container).toBeEmptyDOMElement();
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
        <OnboardingChecklist {...buildProps({
          keywordsCount: 3,
          hasRunAnalysis: true,
        })} />
      );

      expect(container).toBeEmptyDOMElement();
    });

    it('stays visible when only the optional schedule step is incomplete and a required step is pending', () => {
      mockUseOnboardingStatus.mockReturnValue({
        status: buildStatus({
          providersConfigured: true,
          brandConfigured: true,
        }),
        loading: false,
      });

      render(<OnboardingChecklist {...buildProps({ keywordsCount: 3 })} />);

      expect(screen.getByText('Get started with Citation Analysis')).toBeInTheDocument();
    });
  });

  describe('step content', () => {
    it('lists every setup step by title', () => {
      render(<OnboardingChecklist {...buildProps()} />);

      expect(screen.getByText('Add AI provider API keys')).toBeInTheDocument();
      expect(screen.getByText('Add keywords to track')).toBeInTheDocument();
      expect(screen.getByText('Set up brand tracking')).toBeInTheDocument();
      expect(screen.getByText('Run your first analysis')).toBeInTheDocument();
    });

    it('labels the schedule step as optional', () => {
      render(<OnboardingChecklist {...buildProps()} />);

      expect(screen.getByText('Automate runs with a schedule')).toBeInTheDocument();
      expect(screen.getByText('Optional')).toBeInTheDocument();
    });

    it('shows progress of zero when nothing is configured', () => {
      render(<OnboardingChecklist {...buildProps()} />);

      expect(screen.getByText('0 of 4 required steps done')).toBeInTheDocument();
    });

    it('counts configured signals in the progress badge', () => {
      mockUseOnboardingStatus.mockReturnValue({
        status: buildStatus({ providersConfigured: true }),
        loading: false,
      });

      render(<OnboardingChecklist {...buildProps({ keywordsCount: 2 })} />);

      expect(screen.getByText('2 of 4 required steps done')).toBeInTheDocument();
    });

    it('hides the action button for completed steps', () => {
      mockUseOnboardingStatus.mockReturnValue({
        status: buildStatus({ providersConfigured: true }),
        loading: false,
      });

      render(<OnboardingChecklist {...buildProps()} />);

      expect(screen.queryByRole('button', { name: 'Configure providers' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add keywords' })).toBeInTheDocument();
    });
  });

  describe('step navigation', () => {
    it('navigates to provider settings when the provider action is clicked', async () => {
      const props = buildProps();
      render(<OnboardingChecklist {...props} />);

      await userEvent.click(screen.getByRole('button', { name: 'Configure providers' }));

      expect(props.onNavigateToSettings).toHaveBeenCalledWith('providers');
    });

    it('navigates to keyword settings when the keyword action is clicked', async () => {
      const props = buildProps();
      render(<OnboardingChecklist {...props} />);

      await userEvent.click(screen.getByRole('button', { name: 'Add keywords' }));

      expect(props.onNavigateToSettings).toHaveBeenCalledWith('keywords');
    });

    it('navigates to brand settings when the brand action is clicked', async () => {
      const props = buildProps();
      render(<OnboardingChecklist {...props} />);

      await userEvent.click(screen.getByRole('button', { name: 'Configure brands' }));

      expect(props.onNavigateToSettings).toHaveBeenCalledWith('brand-config');
    });

    it('navigates to the execution tab when the run action is clicked', async () => {
      const props = buildProps();
      render(<OnboardingChecklist {...props} />);

      await userEvent.click(screen.getByRole('button', { name: 'Run analysis' }));

      expect(props.setActiveTab).toHaveBeenCalledWith('execution');
    });

    it('navigates to the schedule tab when the schedule action is clicked', async () => {
      const props = buildProps();
      render(<OnboardingChecklist {...props} />);

      await userEvent.click(screen.getByRole('button', { name: 'Create schedule' }));

      expect(props.setActiveTab).toHaveBeenCalledWith('schedule');
    });
  });

  describe('dismissal', () => {
    it('persists the dismissal flag when set up later is clicked', async () => {
      render(<OnboardingChecklist {...buildProps()} />);

      await userEvent.click(screen.getByRole('button', { name: 'Set up later' }));

      expect(localStorageMock.setItem).toHaveBeenCalledWith(ONBOARDING_DISMISSED_STORAGE_KEY, 'true');
    });

    it('hides the checklist when set up later is clicked', async () => {
      render(<OnboardingChecklist {...buildProps()} />);

      await userEvent.click(screen.getByRole('button', { name: 'Set up later' }));

      expect(screen.queryByText('Get started with Citation Analysis')).not.toBeInTheDocument();
    });

    it('disables status fetching when previously dismissed', () => {
      localStorageMock.store[ONBOARDING_DISMISSED_STORAGE_KEY] = 'true';

      render(<OnboardingChecklist {...buildProps()} />);

      expect(mockUseOnboardingStatus).toHaveBeenCalledWith(false);
    });
  });
});
