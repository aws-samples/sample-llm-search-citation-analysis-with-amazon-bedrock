import { useState } from 'react';
import { useUserManagement } from '../../hooks/useUserManagement';
import type { CognitoUser } from '../../api/users';
import {
  InviteModal,
  UserDetailsModal,
  getStatusBadgeClass,
  getStatusLabel,
  formatDate,
} from './UserModals';

class InviteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InviteError';
  }
}

export function UsersConfig() {
  const {
    users,
    groups,
    loading,
    error,
    total,
    refresh,
    invite,
    update,
    remove,
    resetPassword,
  } = useUserManagement();

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<CognitoUser | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleInvite = async (email: string, selectedGroups: string[]) => {
    const result = await invite({
      email,
      groups: selectedGroups 
    });
    if (result.success) {
      setSuccessMessage(result.message ?? 'User invited successfully');
      setTimeout(() => setSuccessMessage(null), 5000);
    } else {
      throw new InviteError(result.message ?? 'Failed to invite user');
    }
  };

  const handleUpdate = async (enabled: boolean, selectedGroups: string[]) => {
    if (!selectedUser) return;
    await update(selectedUser.username, {
      enabled,
      groups: selectedGroups 
    });
  };

  const handleResetPassword = async () => {
    if (!selectedUser) return;
    const result = await resetPassword(selectedUser.username);
    if (result.success) {
      setSuccessMessage(result.message ?? 'Password reset email sent');
      setTimeout(() => setSuccessMessage(null), 5000);
    }
  };

  const handleDelete = async () => {
    if (!selectedUser) return;
    await remove(selectedUser.username);
  };

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading users...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">User Management</h3>
          <p className="text-xs text-gray-500 mt-1">
            Manage Cognito users: invite, enable/disable, and assign groups
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
          <button
            onClick={() => setShowInviteModal(true)}
            className="px-3 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Invite User
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      {successMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700">{successMessage}</div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Groups</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                  No users found. Invite your first user to get started.
                </td>
              </tr>
            ) : (
              users.map(user => (
                <tr key={user.username} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{user.email}</p>
                      <p className="text-xs text-gray-500 font-mono truncate max-w-[200px]">{user.username}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusBadgeClass(user.status, user.enabled)}`}>
                      {getStatusLabel(user.status, user.enabled)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {user.groups.length === 0 ? (
                        <span className="text-xs text-gray-400">No groups</span>
                      ) : (
                        user.groups.map(group => (
                          <span key={group} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                            {group}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {formatDate(user.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setSelectedUser(user)}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                      title="View details"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-gray-500 text-center">
        Showing {users.length} of {total} users
      </div>

      {showInviteModal && (
        <InviteModal
          groups={groups}
          onClose={() => setShowInviteModal(false)}
          onInvite={handleInvite}
        />
      )}

      {selectedUser && (
        <UserDetailsModal
          user={selectedUser}
          groups={groups}
          onClose={() => setSelectedUser(null)}
          onUpdate={handleUpdate}
          onResetPassword={handleResetPassword}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
