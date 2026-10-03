import type { DragEvent } from 'react';
import type { ReportBlock } from '../../../../api/customReports';
import {
  Button, ChevronDownIcon, TrashIcon
} from '../../../ui';
import {
  blockName, catalogEntry, categoryLabel, dataBlockDefinition, scopeNeed
} from '../blockCatalog';
import type { DraftBlock } from '../blockOrder';
import { ContentBlockEditor } from '../content/ContentBlockEditor';
import { isContentBlock } from '../content/contentBlocks';

export interface CardHandlers {
  readonly onShift: (key: string, delta: -1 | 1) => void;
  readonly onRemove: (key: string) => void;
  readonly onChange: (key: string, block: ReportBlock) => void;
  readonly onItemDragStart: (key: string) => void;
  readonly onDragEnd: () => void;
}

interface Props extends CardHandlers {
  readonly item: DraftBlock;
  readonly position: number;
  readonly count: number;
  /** Show every content block's problem, as after a refused save. */
  readonly revealProblems: boolean;
  readonly onDragOver: (event: DragEvent<HTMLLIElement>, position: number) => void;
}

/** What the card says under its name: a section's description and the scope it needs. */
function BlockSummary({ type }: { readonly type: string }) {
  const definition = dataBlockDefinition(type);
  if (definition === undefined) {
    return <p className="text-xs text-amber-700">This block is no longer offered and will not show. Remove it.</p>;
  }
  const need = scopeNeed(definition.scopes);
  const coverage = definition.everyKeyword === true ? ' It always covers every keyword.' : '';
  return (
    <p className="text-xs text-gray-500">
      {definition.description}
      {need !== null && ` Shows when the report is set to ${need}.`}
      {coverage}
    </p>
  );
}

function CardHeading({ type }: { readonly type: string }) {
  const entry = catalogEntry(type);
  const category = entry === undefined || entry.category === 'content' ? null : categoryLabel(entry.category);
  return (
    <div className="min-w-0">
      {category !== null && <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{category}</p>}
      <p className="text-sm font-medium text-gray-900">{entry?.label ?? blockName(type)}</p>
    </div>
  );
}

/**
 * One block of the report being built. Its heading is the drag handle (the
 * fields below stay free for typing); the buttons move it one place or
 * remove it without a mouse.
 */
export function DraftBlockCard({
  item, position, count, revealProblems, onShift, onRemove, onChange, onItemDragStart, onDragEnd, onDragOver
}: Props) {
  const {
    key, block
  } = item;
  const name = blockName(block.type);
  return (
    <li onDragOver={(event) => onDragOver(event, position)} className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-start gap-2">
        <div
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', name);
            onItemDragStart(key);
          }}
          onDragEnd={onDragEnd}
          title="Drag to move"
          className="flex min-w-0 flex-1 cursor-grab items-start gap-2"
        >
          <span aria-hidden="true" className="mt-0.5 select-none text-xs tabular-nums text-gray-400">{position + 1}</span>
          <CardHeading type={block.type} />
        </div>
        <Button variant="iconOnly" size="sm" aria-label={`Move ${name} up`} disabled={position === 0} onClick={() => onShift(key, -1)}>
          <ChevronDownIcon className="h-4 w-4 rotate-180" />
        </Button>
        <Button variant="iconOnly" size="sm" aria-label={`Move ${name} down`} disabled={position === count - 1} onClick={() => onShift(key, 1)}>
          <ChevronDownIcon className="h-4 w-4" />
        </Button>
        <Button variant="iconOnly" size="sm" aria-label={`Remove ${name}`} onClick={() => onRemove(key)}>
          <TrashIcon className="h-4 w-4" />
        </Button>
      </div>
      <div className="mt-2">
        {isContentBlock(block)
          ? <ContentBlockEditor block={block} onChange={(next) => onChange(key, next)} revealProblem={revealProblems} />
          : <BlockSummary type={block.type} />}
      </div>
    </li>
  );
}
