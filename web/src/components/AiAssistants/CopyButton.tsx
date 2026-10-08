import { useClipboardCopy } from '../../hooks/useClipboardCopy';
import { Button } from '../ui/Button';
import { ClipboardIcon } from '../ui/ClipboardIcon';

interface CopyButtonProps {
  readonly text: string;
  /** What is copied, read out as "Copy <label>". */
  readonly label: string;
}

/** "Copy" button with a polite "Copied" announcement in an `<output>` live region. */
export function CopyButton({
  text, label 
}: CopyButtonProps) {
  const {
    copied, copy 
  } = useClipboardCopy();

  return (
    <span className="print-hidden inline-flex shrink-0 items-center gap-2">
      <output aria-live="polite" className="text-xs font-medium text-green-700">
        {copied === null ? '' : 'Copied'}
      </output>
      <Button
        variant="secondary"
        size="sm"
        aria-label={`Copy ${label}`}
        leadingIcon={<ClipboardIcon className="h-4 w-4" />}
        onClick={() => {
          void copy(text);
        }}
      >
        Copy
      </Button>
    </span>
  );
}
