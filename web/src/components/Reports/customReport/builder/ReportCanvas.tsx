import {
  Fragment, useId, useState, type DragEvent
} from 'react';
import { MAX_REPORT_BLOCKS } from '../../../../api/customReports';
import type { DraftBlock } from '../blockOrder';
import {
  DraftBlockCard, type CardHandlers
} from './DraftBlockCard';

interface Props extends CardHandlers {
  readonly items: readonly DraftBlock[];
  /** A block is being dragged (from the list or within the report). */
  readonly dragging: boolean;
  /** The dragged block was dropped in the gap before position `gap` (`items.length`: the end). */
  readonly onDropAt: (gap: number) => void;
  readonly revealProblems: boolean;
  /** The last change, read out to screen readers. */
  readonly announcement: string;
}

function DropMarker() {
  return <li aria-hidden="true" className="h-1 rounded-full bg-cyan-500" />;
}

/**
 * The report being built: its blocks in order, each one draggable to a new
 * place, and a drop zone at the end. While a block is dragged a line marks
 * where it will land.
 */
export function ReportCanvas({
  items, dragging, onDropAt, revealProblems, announcement, ...handlers
}: Props) {
  const headingId = useId();
  const [gap, setGap] = useState<number | null>(null);
  const shownGap = dragging ? gap : null;

  const overBlock = (event: DragEvent<HTMLLIElement>, position: number) => {
    if (!dragging) return;
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    setGap(event.clientY < box.top + box.height / 2 ? position : position + 1);
  };
  const overEnd = (event: DragEvent<HTMLElement>) => {
    if (!dragging) return;
    event.preventDefault();
    setGap(items.length);
  };
  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    onDropAt(gap ?? items.length);
    setGap(null);
  };

  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-3">
      <div>
        <h3 id={headingId} className="text-lg font-semibold text-gray-900">Your report</h3>
        <p className="text-xs text-gray-500">
          {`${items.length} of ${MAX_REPORT_BLOCKS} blocks. Drag a block by its name to move it, or use its arrows.`}
        </p>
      </div>
      {items.length > 0 && (
        <ol aria-labelledby={headingId} onDrop={drop} className="space-y-2">
          {items.map((item, position) => (
            <Fragment key={item.key}>
              {shownGap === position && <DropMarker />}
              <DraftBlockCard
                item={item}
                position={position}
                count={items.length}
                revealProblems={revealProblems}
                onDragOver={overBlock}
                {...handlers}
              />
            </Fragment>
          ))}
          {shownGap === items.length && <DropMarker />}
        </ol>
      )}
      <div
        onDragOver={overEnd}
        onDrop={drop}
        className={`rounded-lg border-2 border-dashed p-6 text-center text-sm ${dragging ? 'border-cyan-500 bg-cyan-50 text-gray-700' : 'border-gray-200 text-gray-500'}`}
      >
        {items.length === 0 ? 'Your report is empty. Add blocks from the list, or drag them here.' : 'Drop a block here to add it at the end.'}
      </div>
      <p aria-live="polite" className="sr-only">{announcement}</p>
    </section>
  );
}
