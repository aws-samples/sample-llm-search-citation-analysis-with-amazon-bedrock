import {
  useContext, type RefObject
} from 'react';
import { CHART_FRAME_CONTEXT } from './chartFrame';

interface Props {
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  /** Whether there is anything to draw; otherwise `emptyText` is shown instead of the chart. */
  readonly hasData: boolean;
  /** The chart's figures in words, for screen readers. */
  readonly caption: string;
  readonly emptyText: string;
  /** The canvas box height (Tailwind class): fixed, so the chart prints at a known size. */
  readonly heightClassName?: string;
}

// Stryker disable next-line StringLiteral: Tailwind-only card frame
const SECTION_FRAME_CLASS = 'rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800';

/**
 * A chart canvas in a fixed-height box with a screen-reader caption, kept on
 * one printed page; a plain sentence when there is nothing to draw. Straight
 * inside a report section it frames itself as a card, like a ChartPanel.
 */
export function ChartFigure({
  canvasRef, hasData, caption, emptyText, heightClassName = 'h-72'
}: Props) {
  const frame = useContext(CHART_FRAME_CONTEXT);
  if (!hasData) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">{emptyText}</p>;
  }
  return (
    <figure className={frame === 'section' ? `avoid-break-inside ${SECTION_FRAME_CLASS}` : 'avoid-break-inside'}>
      <div className={`relative ${heightClassName}`}>
        <canvas ref={canvasRef} />
      </div>
      <figcaption className="sr-only">{caption}</figcaption>
    </figure>
  );
}
