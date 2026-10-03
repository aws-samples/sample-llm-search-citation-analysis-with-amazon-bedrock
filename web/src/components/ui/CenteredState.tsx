import type { ReactNode } from 'react';
import { Spinner } from './Spinner';

const FRAME_CLASS = 'text-center py-12 text-gray-500';

/** Centred grey status line (a plain loading or empty message). */
export const CenteredMessage = ({ children }: { readonly children: ReactNode }) => (
  <div className={FRAME_CLASS}>{children}</div>
);

/** Centred large spinner above a loading message. */
export const CenteredLoading = ({ label }: { readonly label: string }) => (
  <div className={FRAME_CLASS}>
    <Spinner size="lg" className="mx-auto mb-4" />
    {label}
  </div>
);

interface CenteredEmptyProps {
  /** Illustration, sized `w-12 h-12 mx-auto mb-4 text-gray-300`. */
  readonly icon: ReactNode;
  readonly title: string;
  readonly hint?: string;
}

/** Centred empty-state illustration, message and optional hint line. */
export const CenteredEmpty = ({
  icon, title, hint
}: CenteredEmptyProps) => (
  <div className={FRAME_CLASS}>
    {icon}
    <p>{title}</p>
    {hint && <p className="text-sm mt-1">{hint}</p>}
  </div>
);
