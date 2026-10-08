import type { ReactNode } from 'react';
import { CopyButton } from './CopyButton';

interface CodeBlockProps {
  readonly label: string;
  readonly value: string;
  /** Extra actions next to Copy (e.g. a download button). */
  readonly actions?: ReactNode;
  /** Wrap long lines (prose such as instructions) instead of scrolling sideways. */
  readonly wrap?: boolean;
}

/** A labelled monospace block with its own Copy button; it scrolls sideways unless `wrap` is set. */
export function CodeBlock({
  label, value, actions, wrap = false
}: CodeBlockProps) {
  return (
    <figure className="avoid-break-inside overflow-hidden rounded-lg border border-gray-200">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600">
        <span>{label}</span>
        <span className="flex flex-wrap items-center gap-2">
          {actions}
          <CopyButton text={value} label={label} />
        </span>
      </figcaption>
      <pre className={`${wrap ? 'whitespace-pre-wrap break-words' : 'overflow-x-auto'} bg-gray-900 p-3 text-sm leading-relaxed text-gray-100`}>
        <code className="font-mono">{value}</code>
      </pre>
    </figure>
  );
}
