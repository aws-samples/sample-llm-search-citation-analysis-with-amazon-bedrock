import type { ReactNode } from 'react';

interface PageHeaderCardProps {
  readonly title: string;
  readonly description: ReactNode;
  /** Description line height: relaxed (default) or the normal leading. */
  readonly relaxed?: boolean;
  /** Extra content under the description, inside the text column. */
  readonly note?: ReactNode;
  /** Controls stacked under the text column (scope picker, buttons, a stat). */
  readonly children?: ReactNode;
  /** Content under the whole stack, still inside the card. */
  readonly footer?: ReactNode;
}

/** White card at the top of a view: page title, description and its controls. */
export const PageHeaderCard = ({
  title, description, relaxed = true, note, children, footer
}: PageHeaderCardProps) => (
  <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
    <div className="flex flex-col gap-4">
      <div className="flex-1">
        <h2 className="text-lg sm:text-xl font-semibold text-gray-900">{title}</h2>
        <p className={relaxed ? 'text-sm text-gray-500 mt-2 leading-relaxed' : 'text-sm text-gray-500 mt-2'}>{description}</p>
        {note}
      </div>
      {children}
    </div>
    {footer}
  </div>
);
