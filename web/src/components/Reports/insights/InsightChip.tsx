/** The colour of a chip: a standing to keep, one to watch, or one to fix. */
export type ChipTone = 'good' | 'watch' | 'bad';

const TONE_CLASSES: Readonly<Record<ChipTone, string>> = {
  good: 'bg-emerald-100 text-emerald-800',
  watch: 'bg-amber-100 text-amber-800',
  bad: 'bg-red-100 text-red-800',
};

interface ChipProps {
  readonly label: string;
  readonly tone: ChipTone;
}

/** A small tinted label in a table cell: an engine's play, a weak brand, an unstable keyword. */
export function InsightChip({
  label, tone
}: ChipProps) {
  return <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}>{label}</span>;
}

interface MarkedNameProps {
  readonly name: string;
  /** The chip shown after the name when `marked`. */
  readonly marker: string;
  readonly tone: ChipTone;
  readonly marked: boolean;
}

/** A row's name, followed by its marker chip when the row is marked. */
export function MarkedName({
  name, marker, tone, marked
}: MarkedNameProps) {
  return (
    <>
      <span className="font-medium text-gray-900 dark:text-white">{name}</span>
      {marked && <span className="ml-2"><InsightChip label={marker} tone={tone} /></span>}
    </>
  );
}
