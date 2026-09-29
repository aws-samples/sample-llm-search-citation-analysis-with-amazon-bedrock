import {
  useId, useState, type ReactNode
} from 'react';
import { ChevronDownIcon } from './Icons';

interface Props {
  /** The heading text; the whole heading is the toggle. */
  readonly title: string;
  /** The heading element: `h2` in reports, `h3` in dashboard panels. */
  readonly headingLevel: 2 | 3;
  /** The heading's own typography, as the surrounding frame styles its headings. */
  readonly headingClassName: string;
  /** Lets a surrounding region take its name from the heading (`aria-labelledby`). */
  readonly headingId?: string;
  readonly children: ReactNode;
}

/**
 * A heading that shows or hides the content under it, collapsed until the
 * reader asks for it, so reference material (such as the KPI definitions)
 * does not take up the page. On paper it is always open: `print-reveal`
 * (`index.css`) shows the collapsed content in print and in `?print=1`, and
 * the chevron is print-hidden, so a printed report reads as a plain heading
 * and its content.
 */
export function Disclosure({
  title, headingLevel, headingClassName, headingId, children
}: Props) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  // Stryker disable next-line StringLiteral: Tailwind-only chevron rotation; aria-expanded carries the state
  const chevronTurn = open ? 'rotate-180' : '';

  return (
    <>
      <Heading id={headingId} className={headingClassName}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-2 rounded text-left hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 dark:hover:text-gray-300"
        >
          {title}
          <ChevronDownIcon className={`print-hidden h-4 w-4 transition-transform ${chevronTurn}`} />
        </button>
      </Heading>
      <div id={contentId} hidden={!open} className="print-reveal mt-3">
        {children}
      </div>
    </>
  );
}
