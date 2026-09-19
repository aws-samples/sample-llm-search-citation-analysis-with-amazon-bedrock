import type { ReactNode } from 'react';

interface ViewerHeaderProps {
  /** Object name, truncated when it overflows. */
  readonly name: string;
  /** Size / date line rendered under the name. */
  readonly details: ReactNode;
  /** Header actions, laid out in the trailing button group. */
  readonly children: ReactNode;
}

/** Grey header strip shared by the file and image viewers. */
export const ViewerHeader = ({
  name, details, children
}: ViewerHeaderProps) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-gray-50 rounded-lg p-4 gap-3">
    <div className="min-w-0">
      <h3 className="font-medium text-gray-900 truncate">{name}</h3>
      <p className="text-xs sm:text-sm text-gray-500">{details}</p>
    </div>
    <div className="flex items-center gap-2 shrink-0">{children}</div>
  </div>
);
