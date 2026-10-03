import {
  useId, useState
} from 'react';
import type { ReactNode } from 'react';
import {
  MAX_ALT_LENGTH,
  MAX_CAPTION_LENGTH,
  MAX_HEADING_LENGTH,
  MAX_TEXT_LENGTH,
  contentBlockIssue,
} from './contentBlocks';
import type {
  ContentBlock, ContentBlockField, HeadingBlock, ImageBlock, TextBlock, VideoBlock
} from './contentBlocks';
import { MAX_MEDIA_URL_LENGTH } from './mediaLinks';

const LABEL_CLASS = 'block text-sm font-medium text-gray-700 mb-1';
const CONTROL_CLASS = 'w-full p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-gray-900';

/** Which field the shown problem is about, and the id of the message describing it. */
interface ProblemTarget {
  readonly field: ContentBlockField | null;
  readonly messageId: string;
}

interface ControlProps {
  readonly id: string;
  readonly 'aria-invalid': boolean;
  readonly 'aria-describedby': string | undefined;
}

interface LabelledFieldProps {
  readonly label: string;
  readonly hint?: string;
  readonly counter?: string;
  readonly invalid: boolean;
  readonly problemId: string;
  readonly children: (control: ControlProps) => ReactNode;
}

function LabelledField({
  label, hint, counter, invalid, problemId, children
}: LabelledFieldProps) {
  const id = useId();
  const hintId = useId();
  const describedBy = [hint === undefined ? null : hintId, invalid ? problemId : null]
    .filter((entry) => entry !== null)
    .join(' ');
  return (
    <div>
      <label htmlFor={id} className={LABEL_CLASS}>{label}</label>
      {children({
        id,
        'aria-invalid': invalid,
        'aria-describedby': describedBy === '' ? undefined : describedBy,
      })}
      {(hint !== undefined || counter !== undefined) && (
        <div className="mt-1 flex justify-between gap-2 text-xs text-gray-400">
          {hint !== undefined && <p id={hintId}>{hint}</p>}
          {counter !== undefined && <span className="ml-auto tabular-nums">{counter}</span>}
        </div>
      )}
    </div>
  );
}

interface TextFieldProps {
  readonly field: ContentBlockField;
  readonly label: string;
  readonly value: string | undefined;
  readonly maxLength: number;
  readonly hint?: string;
  readonly link?: boolean;
  readonly problem: ProblemTarget;
  readonly onChange: (value: string) => void;
}

function TextField({
  field, label, value, maxLength, hint, link = false, problem, onChange
}: TextFieldProps) {
  return (
    <LabelledField label={label} hint={hint} invalid={problem.field === field} problemId={problem.messageId}>
      {(control) => (
        <input
          {...control}
          type="text"
          value={value ?? ''}
          maxLength={maxLength}
          inputMode={link ? 'url' : undefined}
          spellCheck={link ? false : undefined}
          onChange={(event) => onChange(event.target.value)}
          className={CONTROL_CLASS}
        />
      )}
    </LabelledField>
  );
}

interface FieldsProps<Block extends ContentBlock> {
  readonly block: Block;
  readonly problem: ProblemTarget;
  /** A typed change: reveals the block's problem from now on. */
  readonly onEdit: (next: Block) => void;
  /** A picked change (a size): leaves the problem hidden if it still is. */
  readonly onPick: (next: Block) => void;
}

function HeadingFields({
  block, problem, onEdit, onPick
}: FieldsProps<HeadingBlock>) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
      <TextField
        field="text"
        label="Heading text"
        value={block.text}
        maxLength={MAX_HEADING_LENGTH}
        problem={problem}
        onChange={(text) => onEdit({
          ...block,
          text,
        })}
      />
      <LabelledField label="Size" invalid={false} problemId={problem.messageId}>
        {(control) => (
          <select
            {...control}
            value={block.level}
            onChange={(event) => onPick({
              ...block,
              level: event.target.value === '3' ? 3 : 2,
            })}
            className={CONTROL_CLASS}
          >
            <option value={2}>Large</option>
            <option value={3}>Small</option>
          </select>
        )}
      </LabelledField>
    </div>
  );
}

function TextFields({
  block, problem, onEdit
}: FieldsProps<TextBlock>) {
  return (
    <LabelledField
      label="Text"
      hint="Markdown: **bold**, *italic*, lists, links and tables"
      counter={`${block.markdown.length} / ${MAX_TEXT_LENGTH}`}
      invalid={problem.field === 'markdown'}
      problemId={problem.messageId}
    >
      {(control) => (
        <textarea
          {...control}
          rows={6}
          value={block.markdown}
          maxLength={MAX_TEXT_LENGTH}
          onChange={(event) => onEdit({
            ...block,
            markdown: event.target.value,
          })}
          className={CONTROL_CLASS}
        />
      )}
    </LabelledField>
  );
}

type MediaFieldsProps<Block extends ImageBlock | VideoBlock> = Omit<FieldsProps<Block>, 'onPick'> & {
  readonly linkLabel: string;
  readonly linkHint: string;
  /** Fields between the link and the caption. */
  readonly children?: ReactNode;
};

function MediaFields<Block extends ImageBlock | VideoBlock>({
  block, problem, onEdit, linkLabel, linkHint, children
}: MediaFieldsProps<Block>) {
  return (
    <div className="space-y-3">
      <TextField
        field="url"
        label={linkLabel}
        hint={linkHint}
        value={block.url}
        maxLength={MAX_MEDIA_URL_LENGTH}
        link
        problem={problem}
        onChange={(url) => onEdit({
          ...block,
          url,
        })}
      />
      {children}
      <TextField
        field="caption"
        label="Caption (optional)"
        value={block.caption}
        maxLength={MAX_CAPTION_LENGTH}
        problem={problem}
        onChange={(caption) => onEdit({
          ...block,
          caption,
        })}
      />
    </div>
  );
}

function ImageFields({
  block, problem, onEdit
}: FieldsProps<ImageBlock>) {
  return (
    <MediaFields block={block} problem={problem} onEdit={onEdit} linkLabel="Image link" linkHint="An https link to the image">
      <TextField
        field="alt"
        label="Description"
        hint="Read aloud to people who cannot see the image"
        value={block.alt}
        maxLength={MAX_ALT_LENGTH}
        problem={problem}
        onChange={(alt) => onEdit({
          ...block,
          alt,
        })}
      />
    </MediaFields>
  );
}

function VideoFields({
  block, problem, onEdit
}: FieldsProps<VideoBlock>) {
  return <MediaFields block={block} problem={problem} onEdit={onEdit} linkLabel="Video link" linkHint="A YouTube or Vimeo link" />;
}

interface BlockFieldsProps {
  readonly block: ContentBlock;
  readonly problem: ProblemTarget;
  readonly onEdit: (next: ContentBlock) => void;
  readonly onPick: (next: ContentBlock) => void;
}

function BlockFields({
  block, ...handlers
}: BlockFieldsProps) {
  switch (block.type) {
    case 'heading': return <HeadingFields block={block} {...handlers} />;
    case 'text': return <TextFields block={block} {...handlers} />;
    case 'image': return <ImageFields block={block} {...handlers} />;
    case 'video': return <VideoFields block={block} {...handlers} />;
  }
}

interface ContentBlockEditorProps {
  readonly block: ContentBlock;
  readonly onChange: (next: ContentBlock) => void;
  /** Shows the block's problem even before the user typed in it, e.g. after a refused save. */
  readonly revealProblem?: boolean;
}

/**
 * The fields of one content block. What is wrong with the block (the same
 * check the server makes) shows under the fields once the user has typed in
 * it, so a fresh block does not start out flagged, or once a save was refused.
 */
export function ContentBlockEditor({
  block, onChange, revealProblem = false
}: ContentBlockEditorProps) {
  const messageId = useId();
  const [touched, setTouched] = useState(false);
  const issue = touched || revealProblem ? contentBlockIssue(block) : null;
  const edit = (next: ContentBlock) => {
    setTouched(true);
    onChange(next);
  };
  return (
    <div className="space-y-3">
      <BlockFields
        block={block}
        problem={{
          field: issue?.field ?? null,
          messageId,
        }}
        onEdit={edit}
        onPick={onChange}
      />
      <p id={messageId} aria-live="polite" className="text-xs text-red-600 empty:hidden">{issue?.message}</p>
    </div>
  );
}
