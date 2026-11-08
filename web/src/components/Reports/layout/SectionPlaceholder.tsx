import type { ReactElement } from 'react';

interface Props {
  readonly variant: 'loading' | 'error' | 'empty';
  readonly message: string;
}

/**
 * Shared rendering helpers for Keyword Deep Dive sections.
 *
 * Each section follows the same pattern: a fetch may be loading, may have
 * errored, or may be missing data even after settling. Centralising the
 * three placeholder messages keeps the section components themselves focused
 * on their actual layout work.
 */
export function SectionPlaceholder({
  variant, message 
}: Props): ReactElement {
  const baseClass = 'text-sm rounded-sm border px-4 py-3';
  const variantClass =
    variant === 'error'
      ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300'
      : 'border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400';
  return <div className={`${baseClass} ${variantClass}`}>{message}</div>;
}
