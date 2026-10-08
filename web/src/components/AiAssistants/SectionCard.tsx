import {
  useId, type ReactNode 
} from 'react';

interface SectionCardProps {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}

/** A titled white card; the section takes its accessible name from the heading. */
export function SectionCard({
  title, description, children 
}: SectionCardProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6">
      <h3 id={headingId} className="text-lg font-semibold text-gray-900">{title}</h3>
      <p className="mb-4 mt-1 text-sm text-gray-500">{description}</p>
      {children}
    </section>
  );
}
