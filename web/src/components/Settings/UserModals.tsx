import {useState} from 'react';
import { createPortal } from 'react-dom';
import type {
  CognitoUser, UserGroup 
} from '../../api/users';

export function createGroupToggler(setSelectedGroups: React.Dispatch<React.SetStateAction<string[]>>) {
  return (groupName: string) => {
    setSelectedGroups(prev =>
      prev.includes(groupName)
        ? prev.filter(g => g !== groupName)
        : [...prev, groupName]
    );
  };
}

export function getStatusBadgeClass(status: string, enabled: boolean): string {
  if (!enabled) return 'bg-red-100 text-red-700';
  switch (status) {
    case 'CONFIRMED':
      return 'bg-emerald-100 text-emerald-700';
    case 'FORCE_CHANGE_PASSWORD':
      return 'bg-amber-100 text-amber-700';
    case 'UNCONFIRMED':
      return 'bg-gray-100 text-gray-600';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

export function getStatusLabel(status: string, enabled: boolean): string {
  if (!enabled) return 'Disabled';
  switch (status) {
    case 'CONFIRMED':
      return 'Active';
    case 'FORCE_CHANGE_PASSWORD':
      return 'Pending';
    case 'UNCONFIRMED':
      return 'Unconfirmed';
    case 'RESET_REQUIRED':
      return 'Reset Required';
    default:
      return status;
  }
}

export function formatDate(dateString: string | null): string {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString();
}

interface InviteModalProps {
  readonly groups: UserGroup[];
  readonly onClose: () => void;
  readonly onInvite: (email: string, groups: string[]) => Promise<void>;
}

export function InviteModal({
  groups, onClose, onInvite 
}: InviteModalProps) {
  const [email, setEmail] = useState('');
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    
    setLoading(true);
    setError(null);
    try {
      await onInvite(email.trim(), selectedGroups);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite user');
    } finally {
      setLoading(false);
    }
  };

  const toggleGroup = createGroupToggler(setSelectedGroups);

  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Invite User</h3>
          
          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="w-full p-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-gray-900"
                  autoFocus
                  required
                />
              </div>
              
              {groups.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Groups (optional)
                  </label>
                  <div className="space-y-2">
                    {groups.map(group => (
                      <label key={group.name} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedGroups.includes(group.name)}
                          onChange={() => toggleGroup(group.name)}
                          className="rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                        />
                        <span className="text-sm text-gray-700">{group.name}</span>
                        {group.description && (
                          <span className="text-xs text-gray-500">- {group.description}</span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {error}
                </div>
              )}
            </div>
            
            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !email.trim()}
                className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {loading && (
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                )}
                Send Invite
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
}

interface UserDetailsModalProps {
  readonly user: CognitoUser;
  readonly groups: UserGroup[];
  readonly onClose: () => void;
  readonly onUpdate: (enabled: boolean, groups: string[]) => Promise<void>;
  readonly onResetPassword: () => Promise<void>;
  readonly onDelete: () => Promise<void>;
}

export function UserDetailsModal({
  user, groups, onClose, onUpdate, onResetPassword, onDelete 
}: UserDetailsModalProps) {
  const [enabled, setEnabled] = useState(user.enabled);
  const [selectedGroups, setSelectedGroups] = useState<string[]>(user.groups);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const sortedSelected = [...selectedGroups].sort((a, b) => a.localeCompare(b));
  const sortedUserGroups = [...user.groups].sort((a, b) => a.localeCompare(b));
  const hasChanges = enabled !== user.enabled || 
    JSON.stringify(sortedSelected) !== JSON.stringify(sortedUserGroups);

  const handleSave = async () => {
    setLoading(true);
    try {
      await onUpdate(enabled, selectedGroups);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    setLoading(true);
    try {
      await onResetPassword();
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setLoading(true);
    try {
      await onDelete();
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const toggleGroup = createGroupToggler(setSelectedGroups);

  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">{user.email}</h3>
              <p className="text-sm text-gray-500">User Details</p>
            </div>
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusBadgeClass(user.status, user.enabled)}`}>
              {getStatusLabel(user.status, user.enabled)}
            </span>
          </div>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Username</span>
                <p className="font-mono text-gray-900 truncate">{user.username}</p>
              </div>
              <div>
                <span className="text-gray-500">Email Verified</span>
                <p className="text-gray-900">{user.email_verified ? 'Yes' : 'No'}</p>
              </div>
              <div>
                <span className="text-gray-500">Created</span>
                <p className="text-gray-900">{formatDate(user.created_at)}</p>
              </div>
              <div>
                <span className="text-gray-500">Last Updated</span>
                <p className="text-gray-900">{formatDate(user.updated_at)}</p>
              </div>
            </div>
            
            <div className="border-t border-gray-200 pt-4">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm font-medium text-gray-700">Account Enabled</span>
                <button
                  onClick={() => setEnabled(!enabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    enabled ? 'bg-emerald-500' : 'bg-gray-300'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    enabled ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </label>
            </div>
            
            {groups.length > 0 && (
              <div className="border-t border-gray-200 pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Groups</label>
                <div className="space-y-2">
                  {groups.map(group => (
                    <label key={group.name} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedGroups.includes(group.name)}
                        onChange={() => toggleGroup(group.name)}
                        className="rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                      />
                      <span className="text-sm text-gray-700">{group.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            
            <div className="border-t border-gray-200 pt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">Actions</h4>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleResetPassword}
                  disabled={loading}
                  className="px-3 py-1.5 text-xs bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 transition-colors disabled:opacity-50"
                >
                  Reset Password
                </button>
                <button
                  onClick={handleDelete}
                  disabled={loading}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-50 ${
                    confirmDelete 
                      ? 'bg-red-600 text-white hover:bg-red-700' 
                      : 'bg-red-100 text-red-700 hover:bg-red-200'
                  }`}
                >
                  {confirmDelete ? 'Confirm Delete' : 'Delete User'}
                </button>
              </div>
              {confirmDelete && (
                <p className="text-xs text-red-600 mt-2">
                  Click again to confirm deletion. This cannot be undone.
                </p>
              )}
            </div>
          </div>
          
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={loading || !hasChanges}
              className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {loading && (
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
