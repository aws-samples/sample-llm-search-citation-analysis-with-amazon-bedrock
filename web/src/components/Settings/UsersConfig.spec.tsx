import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UsersConfig } from './UsersConfig';

vi.mock('../../hooks/useUserManagement', () => ({useUserManagement: vi.fn(),}));

vi.mock('./UserModals', () => ({
  InviteModal: () => <div data-testid="invite-modal">Invite Modal</div>,
  UserDetailsModal: ({ user }: { user: unknown }) => user ? <div data-testid="user-details-modal">User Details</div> : null,
  getStatusBadgeClass: () => 'badge-class',
  getStatusLabel: (status: string) => status,
}));

import { useUserManagement } from '../../hooks/useUserManagement';

const mockUseUserManagement = vi.mocked(useUserManagement);

function buildMockHook(overrides = {}) {
  return {
    users: [],
    groups: [{
      name: 'admin',
      description: 'Administrators',
      precedence: 1 
    }, {
      name: 'user',
      description: 'Users',
      precedence: 2 
    }],
    loading: false,
    error: null,
    total: 0,
    hasMore: false,
    refresh: vi.fn(),
    invite: vi.fn().mockResolvedValue({ success: true }),
    update: vi.fn().mockResolvedValue({ success: true }),
    remove: vi.fn().mockResolvedValue({ success: true }),
    resetPassword: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
}

function renderUsersConfig(hookOverrides = {}) {
  mockUseUserManagement.mockReturnValue(buildMockHook(hookOverrides));
  render(<UsersConfig />);
}

describe('UsersConfig', () => {
  beforeEach(() => {
    mockUseUserManagement.mockReturnValue(buildMockHook());
  });

  describe('loading state', () => {
    it('shows loading message when loading', () => {
      renderUsersConfig({ loading: true });

      expect(screen.getByText(/loading users/i)).toBeInTheDocument();
    });
  });

  describe('header', () => {
    it('displays User Management title', () => {
      renderUsersConfig();

      expect(screen.getByText('User Management')).toBeInTheDocument();
    });

    it('displays Invite User button', () => {
      renderUsersConfig();

      expect(screen.getByRole('button', { name: /invite/i })).toBeInTheDocument();
    });

    it.each(['Refresh', 'Invite User'])('hides the decorative icon of the %s button from assistive technology', (name) => {
      renderUsersConfig();

      expect(screen.getByRole('button', { name }).querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('with users', () => {
    it('displays user email', () => {
      renderUsersConfig({
        users: [{
          username: 'user1',
          email: 'test@example.com',
          status: 'CONFIRMED',
          enabled: true,
          groups: [] 
        }],
        total: 1,
      });

      expect(screen.getByText('test@example.com')).toBeInTheDocument();
    });
  });

  describe('invite modal', () => {
    it('opens the invite modal when the invite button is clicked', async () => {
      renderUsersConfig();

      await userEvent.click(screen.getByRole('button', { name: /invite/i }));

      expect(screen.getByTestId('invite-modal')).toBeInTheDocument();
    });
  });
});
