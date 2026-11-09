import {
  useEffect, useRef, type ReactNode
} from 'react';

interface BriefStepProps {
  readonly number: number;
  /** The question the step answers; it names the step's group of controls. */
  readonly title: string;
  readonly hint?: string;
  /** Scroll this step into view when the form opens (a brief started from a content idea lands on its keyword). */
  readonly scrollIntoViewOnMount?: boolean;
  readonly children: ReactNode;
}

/**
 * One numbered step of the Content Brief form: a fieldset whose legend is the
 * step number and its question, so each step reads as one decision. The
 * legend floats so it sits inside the card instead of on its border.
 */
export function BriefStep({
  number, title, hint, scrollIntoViewOnMount = false, children
}: BriefStepProps) {
  const ref = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    if (scrollIntoViewOnMount) ref.current?.scrollIntoView?.({ block: 'start' });
  }, [scrollIntoViewOnMount]);
  return (
    <fieldset ref={ref} className="m-0 min-w-0 rounded-xl border border-gray-200 bg-white p-5">
      <legend className="float-left flex w-full items-center gap-3 p-0 text-base font-semibold text-gray-900">
        <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white">
          {number}
        </span>
        {/* One text node for the name, so assistive technology reads "Step 1: …" with its space. */}
        <span className="sr-only">{`Step ${number}: ${title}`}</span>
        <span aria-hidden="true" className="min-w-0">{title}</span>
      </legend>
      <div className="clear-left space-y-4 pt-1 sm:pl-9">
        {hint && <p className="text-sm text-gray-500">{hint}</p>}
        {children}
      </div>
    </fieldset>
  );
}
