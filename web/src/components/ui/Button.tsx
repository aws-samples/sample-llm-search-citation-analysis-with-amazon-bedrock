/**
 * Centralized Button component implementing the project design system.
 *
 * Variants:
 *   - `primary` (default) – high contrast call-to-action.
 *   - `secondary` – low contrast neutral action.
 *   - `ghost` – minimal, used inside dense lists / tables.
 *   - `danger` – destructive primary action.
 *   - `iconOnly` – square button hosting only an icon (use `aria-label`).
 *
 * Sizes:
 *   - `sm` (32px height)
 *   - `md` (default, 36-40px height)
 *
 * Dark mode is handled at the global stylesheet level (see `index.css`),
 * which is why `bg-gray-900 / hover:bg-gray-800` works in both themes
 * without explicit `dark:` variants.
 *
 * See `docs/design-system.md` for usage guidance.
 */

import type {
  ButtonHTMLAttributes, ReactNode 
} from 'react';

type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'iconOnly';

type ButtonSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly leadingIcon?: ReactNode;
}

const baseClasses =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-gray-500';

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
};

const iconOnlySizeClasses: Record<ButtonSize, string> = {
  sm: 'p-1.5',
  md: 'p-2',
};

const variantClasses = (variant: ButtonVariant): string => {
  switch (variant) {
    case 'primary':
      return 'bg-gray-900 text-white hover:bg-gray-800 disabled:bg-gray-300';
    case 'secondary':
      return 'bg-white text-gray-900 border border-gray-200 hover:bg-gray-50';
    case 'ghost':
      return 'text-gray-600 hover:text-gray-900 hover:bg-gray-100';
    case 'danger':
      return 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300';
    case 'iconOnly':
      return 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md';
  }
};

export const Button = ({
  variant = 'primary',
  size = 'md',
  leadingIcon,
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonProps) => {
  const sizing = variant === 'iconOnly' ? iconOnlySizeClasses[size] : sizeClasses[size];
  const variantStyles = variantClasses(variant);

  return (
    <button
      type={type}
      className={`${baseClasses} ${sizing} ${variantStyles} ${className}`.trim()}
      {...rest}
    >
      {leadingIcon}
      {children}
    </button>
  );
};
