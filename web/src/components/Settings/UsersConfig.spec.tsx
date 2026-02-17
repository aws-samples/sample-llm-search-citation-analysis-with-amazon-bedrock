import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { UsersConfig } from './UsersConfig';

vi.mock('../../hooks/useUserManagement', () => ({useUserManagement: vi.fn(),}));

vi.mock('./UserModals', () => ({
  InviteModal: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div data-testid="invite-modal">Invite Modal</div> : null,
  UserDetailsModal: ({ user }: { user: unknown }) => user ? <div data-testid="user-details-modal">User Details</div> : null,
  getStatusBadgeClass: () => 'badge-class',
  getStatusLabel: (status: string) => status,
  formatDate: (date: string) => date,
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

describe('UsersConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseUserManagement.mockReturnValue(buildMockHook());
  });

  describe('loading state', () => {
    it('shows loading message when loading', () => {
      mockUseUserManagement.mockReturnValue(buildMockHook({ loading: true }));
      render(<UsersConfig />);

      expect(screen.getByText(/loading users/i)).toBeInTheDocument();
    });
  });

  describe('header', () => {
    it('displays User Management title', () => {
      render(<UsersConfig />);

      expect(screen.getByText('User Management')).toBeInTheDocument();
    });

    it('displays Invite User button', () => {
      render(<UsersConfig />);

      expect(screen.getByRole('button', { name: /invite/i })).toBeInTheDocument();
    });
  });

  describe('with users', () => {
    it('displays user email', () => {
      mockUseUserManagement.mockReturnValue(buildMockHook({
        users: [{
          username: 'user1',
          email: 'test@example.com',
          status: 'CONFIRMED',
          enabled: true,
          groups: [] 
        }],
        total: 1,
      }));
      render(<UsersConfig />);

      expect(screen.getByText('test@example.com')).toBeInTheDocument();
    });
  });

  describe('invite modal', () => {
    it('renders invite button', () => {
      render(<UsersConfig />);

      expect(screen.getByRole('button', { name: /invite/i })).toBeInTheDocument();
    });
  });
});
