import type { RefObject } from 'react';

interface Props {
  readonly canvasRef: RefObject<HTMLCanvasElement>;
  /** Whether there is anything to draw; otherwise `emptyText` is shown instead of the chart. */
  readonly hasData: boolean;
  /** The chart's figures in words, for screen readers. */
  readonly caption: string;
  readonly emptyText: string;
  /** The canvas box height (Tailwind class): fixed, so the chart prints at a known size. */
  readonly heightClassName?: string;
}

/**
 * A chart canvas in a fixed-height box with a screen-reader caption, kept on
 * one printed page; a plain sentence when there is nothing to draw.
 */
export function ChartFigure({
  canvasRef, hasData, caption, emptyText, heightClassName = 'h-72'
}: Props) {
  if (!hasData) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">{emptyText}</p>;
  }
  return (
    <figure className="avoid-break-inside">
      <div className={`relative ${heightClassName}`}>
        <canvas ref={canvasRef} />
      </div>
      <figcaption className="sr-only">{caption}</figcaption>
    </figure>
  );
}
