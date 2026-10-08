import { useId } from 'react';
import {
  ROLE_OPTIONS, type UserRole
} from './UserPresentation';

interface UserRolePickerProps {
  readonly value: UserRole;
  readonly onChange: (role: UserRole) => void;
  readonly disabled?: boolean;
  /** Keep the "Role" legend for screen readers only, when a visible heading already names it. */
  readonly legendHidden?: boolean;
}

/** Admin / Member radio cards, each with what the role can do. */
export function UserRolePicker({
  value, onChange, disabled = false, legendHidden = false
}: UserRolePickerProps) {
  const name = useId();
  return (
    <fieldset disabled={disabled}>
      <legend className={legendHidden ? 'sr-only' : 'block text-sm font-medium text-gray-700 mb-1'}>Role</legend>
      <div className="space-y-2">
        {ROLE_OPTIONS.map((option) => (
          <label
            key={option.role}
            className={`flex items-start gap-3 rounded-lg border p-3 ${
              value === option.role ? 'border-gray-900 dark:border-gray-300 bg-gray-50' : 'border-gray-200'
            } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-gray-50'}`}
          >
            <input
              type="radio"
              name={name}
              value={option.role}
              checked={value === option.role}
              onChange={() => onChange(option.role)}
              className="mt-0.5 border-gray-300 text-gray-900 focus:ring-gray-900"
            />
            <span>
              <span className="block text-sm font-medium text-gray-900">{option.label}</span>
              <span className="block text-xs text-gray-500">{option.description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
