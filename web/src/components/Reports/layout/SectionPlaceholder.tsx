import type { ReactElement } from 'react';
import {
  SectionSkeleton, type SectionShape
} from './SectionSkeleton';

interface Props {
  readonly variant: 'loading' | 'error' | 'empty';
  readonly message: string;
  /** What the loading section will show; its skeleton takes that shape (default: lines of text). */
  readonly shape?: SectionShape;
}

/**
 * The body of a report section that has nothing to show yet: a skeleton
 * shaped like its content while it loads (the message is what screen readers
 * hear), a red box with the reason after an error, a grey note when the data
 * source has nothing.
 */
export function SectionPlaceholder({
  variant, message, shape = 'block'
}: Props): ReactElement {
  if (variant === 'loading') return <SectionSkeleton shape={shape} label={message} />;
  const baseClass = 'text-sm rounded-lg border px-4 py-3';
  const variantClass =
    variant === 'error'
      ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300'
      : 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300';
  return <div className={`${baseClass} ${variantClass}`}>{message}</div>;
}
