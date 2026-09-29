import {
  useCallback, useId, useLayoutEffect, useRef, useState, type RefObject
} from 'react';
import { createPortal } from 'react-dom';
import {
  tooltipPosition, type TooltipPosition
} from './tooltipPosition';

interface Props {
  /** What the tooltip explains, e.g. "Citation rate"; names the button for screen readers. */
  readonly label: string;
  readonly text: string;
}

/**
 * Keeps an open tooltip next to its button, inside the viewport, while the
 * page scrolls or resizes; `null` until it has been measured.
 */
function useTooltipPosition(
  open: boolean,
  buttonRef: RefObject<HTMLButtonElement>,
  tooltipRef: RefObject<HTMLSpanElement>,
): TooltipPosition | null {
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  // Stryker disable ArrayDeclaration: ref objects keep their identity for the component's lifetime
  const measure = useCallback(() => {
    const button = buttonRef.current;
    const tooltip = tooltipRef.current;
    // Stryker disable next-line ConditionalExpression,LogicalOperator: both refs are attached before any layout effect runs; the guard only narrows the types
    if (button === null || tooltip === null) return;
    setPosition(tooltipPosition(
      button.getBoundingClientRect(),
      {
        width: tooltip.offsetWidth,
        height: tooltip.offsetHeight,
      },
      {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    ));
  }, [buttonRef, tooltipRef]);
  // Stryker restore ArrayDeclaration

  useLayoutEffect(() => {
    if (!open) return undefined;
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, measure]);

  return position;
}

/**
 * An "i" button that shows `text` on hover, on keyboard focus and on click
 * (touch), and hides it again on Escape or when focus and pointer leave. The
 * text is always the button's accessible description, so screen readers
 * announce it without opening anything. Hidden in print: printed reports
 * carry the same text in their definitions block.
 *
 * The tooltip is rendered into `document.body` with fixed positioning, so a
 * table's scroll container cannot clip it and a `whitespace-nowrap` header
 * cannot stop its text from wrapping.
 */
export function InfoTooltip({
  label, text
}: Props) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const position = useTooltipPosition(open, buttonRef, tooltipRef);

  return (
    <span
      className="relative inline-flex align-middle print-hidden"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={buttonRef}
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
      {createPortal(
        <span
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          hidden={!open}
          style={position ?? undefined}
          className="print-hidden fixed z-50 w-72 max-w-[calc(100vw-1rem)] whitespace-normal break-words rounded-lg border border-gray-200 bg-white p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-gray-700 shadow-lg dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
        >
          {text}
        </span>,
        document.body,
      )}
    </span>
  );
}
