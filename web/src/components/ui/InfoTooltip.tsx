import {
  useId, useState
} from 'react';

interface Props {
  /** What the tooltip explains, e.g. "Citation rate"; names the button for screen readers. */
  readonly label: string;
  readonly text: string;
}

/**
 * An "i" button that shows `text` on hover, on keyboard focus and on click
 * (touch), and hides it again on Escape or when focus and pointer leave. The
 * text is always the button's accessible description, so screen readers
 * announce it without opening anything. Hidden in print: printed reports
 * carry the same text in their definitions block.
 */
export function InfoTooltip({
  label, text
}: Props) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-flex align-middle print-hidden"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={`About ${label}`}
        aria-describedby={tooltipId}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-400 text-[10px] font-semibold leading-none text-gray-500 hover:border-gray-600 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900 dark:border-gray-500 dark:text-gray-400"
      >
        i
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        hidden={!open}
        className="absolute left-1/2 top-6 z-20 w-72 -translate-x-1/2 rounded-lg border border-gray-200 bg-white p-3 text-xs font-normal normal-case tracking-normal text-gray-700 shadow-lg dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
      >
        {text}
      </span>
    </span>
  );
}
