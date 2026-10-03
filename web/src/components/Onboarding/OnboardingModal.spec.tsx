import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen, fireEvent 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  OnboardingModal, ONBOARDING_DISMISSED_STORAGE_KEY, ONBOARDING_COMPLETE_STORAGE_KEY
} from './OnboardingModal';
import {
  buildProps, buildStatus, localStorageMock
} from './OnboardingModal-fixtures';
import { installStorageMock } from '../../test/installStorageMock';

vi.mock('../../hooks/useOnboardingStatus', () => ({useOnboardingStatus: vi.fn(),}));

vi.mock('../../hooks/useIsAdmin', () => ({useIsAdmin: vi.fn(),}));

import { useOnboardingStatus } from '../../hooks/useOnboardingStatus';
import { useIsAdmin } from '../../hooks/useIsAdmin';

const mockUseOnboardingStatus = useOnboardingStatus as ReturnType<typeof vi.fn>;
const mockUseIsAdmin = useIsAdmin as ReturnType<typeof vi.fn>;

/** The setup status the hook resolves to, with loading finished. */
function mockStatus(overrides: Parameters<typeof buildStatus>[0] = {}) {
  mockUseOnboardingStatus.mockReturnValue({
    status: buildStatus(overrides),
    loading: false,
  });
}

/** Providers and brand tracking done; keywords and the first run are counted from props. */
const REQUIRED_SIGNALS_CONFIGURED = {
  providersConfigured: true,
  brandConfigured: true,
};

function renderOnboarding(overrides: Parameters<typeof buildProps>[0] = {}) {
  return render(<OnboardingModal {...buildProps(overrides)} />);
}

/** Stores a dismissal or completion flag from an earlier visit, then mounts the modal. */
function renderOnboardingWithStoredFlag(storageKey: string) {
  localStorageMock.store[storageKey] = 'true';
  return renderOnboarding();
}

beforeEach(() => {
  installStorageMock(localStorageMock);
  // Every onboarding step targets an Admin-only route, so the checklist only
  // renders for admins. Non-admin suppression is asserted separately below.
  mockUseIsAdmin.mockReturnValue({
    isAdmin: true,
    loading: false,
  });
  mockStatus();
});

describe('OnboardingModal', () => {
  describe('visibility', () => {
    it('opens the modal when setup is incomplete', () => {
      renderOnboarding();

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Get started with Citation Analysis')).toBeInTheDocument();
    });

    it('renders nothing while setup status is loading', () => {
      mockUseOnboardingStatus.mockReturnValue({
        status: null,
        loading: true,
      });

      const { container } = renderOnboarding();

      expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when previously skipped', () => {
      const { container } = renderOnboardingWithStoredFlag(ONBOARDING_DISMISSED_STORAGE_KEY);

      expect(container).toBeEmptyDOMElement();
    });

    it('disables status fetching when previously skipped', () => {
      renderOnboardingWithStoredFlag(ONBOARDING_DISMISSED_STORAGE_KEY);

      expect(mockUseOnboardingStatus).toHaveBeenCalledWith(false);
    });

    it('disables status fetching when setup was previously completed', () => {
      const { container } = renderOnboardingWithStoredFlag(ONBOARDING_COMPLETE_STORAGE_KEY);

      expect(mockUseOnboardingStatus).toHaveBeenCalledWith(false);
      expect(container).toBeEmptyDOMElement();
    });

    it('stays open when only optional steps are incomplete and a required step is pending', () => {
      mockStatus(REQUIRED_SIGNALS_CONFIGURED);

      renderOnboarding({ keywordsCount: 3 });

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('completion caching', () => {
    const allRequiredDone = {
      keywordsCount: 3,
      hasRunAnalysis: true,
    };

    it('persists the completion flag when all required steps are complete', () => {
      mockStatus(REQUIRED_SIGNALS_CONFIGURED);

      renderOnboarding(allRequiredDone);

      expect(localStorageMock.setItem).toHaveBeenCalledWith(ONBOARDING_COMPLETE_STORAGE_KEY, 'true');
    });

    it('renders nothing when all required steps are complete', () => {
      mockStatus(REQUIRED_SIGNALS_CONFIGURED);

      const { container } = renderOnboarding(allRequiredDone);

      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('step content', () => {
    it('lists the four required steps by title', () => {
      renderOnboarding();

      expect(screen.getByText('Add AI provider API keys')).toBeInTheDocument();
      expect(screen.getByText('Add keywords to track')).toBeInTheDocument();
      expect(screen.getByText('Set up brand tracking')).toBeInTheDocument();
      expect(screen.getByText('Run your first analysis')).toBeInTheDocument();
    });

    it('lists the optional schedule and persona steps', () => {
      renderOnboarding();

      expect(screen.getByText('Automate runs with a schedule')).toBeInTheDocument();
      expect(screen.getByText('Define user personas')).toBeInTheDocument();
      expect(screen.getAllByText('Optional')).toHaveLength(2);
    });

    it('counts configured signals in the progress badge', () => {
      mockStatus({ providersConfigured: true });

      renderOnboarding({ keywordsCount: 2 });

      expect(screen.getByText('2 of 4 required steps done')).toBeInTheDocument();
    });

    it('hides the action button for completed steps', () => {
      mockStatus({ providersConfigured: true });

      renderOnboarding();

      expect(screen.queryByRole('button', { name: 'Configure providers' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add keywords' })).toBeInTheDocument();
    });
  });

  describe('step navigation', () => {
    /** Mounts the checklist and presses the named button; returns the props to assert on. */
    async function renderAndClick(buttonName: string) {
      const props = buildProps();
      render(<OnboardingModal {...props} />);
      await userEvent.click(screen.getByRole('button', { name: buttonName }));
      return props;
    }

    it('navigates to provider settings when the provider action is clicked', async () => {
      const props = await renderAndClick('Configure providers');

      expect(props.onNavigateToSettings).toHaveBeenCalledWith('providers');
    });

    it('navigates to persona settings when the persona action is clicked', async () => {
      const props = await renderAndClick('Add personas');

      expect(props.onNavigateToSettings).toHaveBeenCalledWith('query-prompts');
    });

    it('navigates to the schedule tab when the schedule action is clicked', async () => {
      const props = await renderAndClick('Create schedule');

      expect(props.setActiveTab).toHaveBeenCalledWith('schedule');
    });

    it('closes the modal when a step action is clicked', async () => {
      await renderAndClick('Run analysis');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('does not persist the skip flag when a step action is clicked', async () => {
      await renderAndClick('Run analysis');

      expect(localStorageMock.setItem).not.toHaveBeenCalledWith(ONBOARDING_DISMISSED_STORAGE_KEY, 'true');
    });

    it('persists the skip flag when set up later is clicked', async () => {
      await renderAndClick('Set up later');

      expect(localStorageMock.setItem).toHaveBeenCalledWith(ONBOARDING_DISMISSED_STORAGE_KEY, 'true');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('Escape', () => {
    function renderAndPressEscape() {
      renderOnboarding();
      fireEvent.keyDown(document, { key: 'Escape' });
    }

    it('closes the modal when Escape is pressed', () => {
      renderAndPressEscape();

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('does not persist the skip flag when Escape is pressed', () => {
      renderAndPressEscape();

      expect(localStorageMock.setItem).not.toHaveBeenCalledWith(ONBOARDING_DISMISSED_STORAGE_KEY, 'true');
    });
  });
});


describe('OnboardingModal for non-admin users', () => {
  /**
   * Every step in the checklist targets an Admin-only route: provider keys,
   * brand config, the first run, schedules, personas. A non-admin would get a
   * blocking modal listing six things they cannot do, so it is suppressed
   * entirely rather than filtered — filtering to an empty list would leave
   * `allRequiredComplete` false and render the modal with no steps at all.
   */

  beforeEach(() => {
    mockUseIsAdmin.mockReturnValue({
      isAdmin: false,
      loading: false,
    });
  });

  it.each([
    {
      content: 'the checklist',
      text: /Get started with Citation Analysis/i,
    },
    {
      content: 'any setup step',
      text: /Add AI provider API keys/i,
    },
  ])('does not render $content for a non-admin user', ({ text }) => {
    renderOnboarding();

    expect(screen.queryByText(text)).not.toBeInTheDocument();
  });

  it('does not render the checklist while admin membership is still loading', () => {
    mockUseIsAdmin.mockReturnValue({
      isAdmin: false,
      loading: true,
    });

    renderOnboarding();

    expect(screen.queryByText(/Get started with Citation Analysis/i)).not.toBeInTheDocument();
  });

  it('does not query setup status for a non-admin user', () => {
    /** Four API calls the caller could never act on. */
    renderOnboarding();

    expect(mockUseOnboardingStatus).toHaveBeenCalledWith(false);
  });
});
