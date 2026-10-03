import { ClipboardIcon } from '../ui/ClipboardIcon';
import { StrokeIcon } from '../ui/StrokeIcon';
import { CHECK_PATHS } from '../ui/iconPaths';

interface CopyButtonLabelProps {
  copied: boolean;
  /** Tailwind size classes shared by the clipboard and the check mark. */
  iconClassName: string;
  label: string;
}

/**
 * Icon-plus-text content of a copy-to-clipboard button: a clipboard with the
 * `label` until the copy lands, then a green check mark with "Copied!".
 */
const CopyButtonLabel = ({
  copied, iconClassName, label
}: CopyButtonLabelProps) => (
  copied ? (
    <>
      <StrokeIcon className={`${iconClassName} text-green-500`} paths={CHECK_PATHS} strokeWidth={2} />
      Copied!
    </>
  ) : (
    <>
      <ClipboardIcon className={iconClassName} />
      {label}
    </>
  )
);

interface CopyButtonProps extends CopyButtonLabelProps {
  onCopy: () => void;
  className: string;
}

/** A copy-to-clipboard button whose content is a `CopyButtonLabel`. */
export const CopyButton = ({
  onCopy, className, ...labelProps
}: CopyButtonProps) => (
  <button onClick={onCopy} className={className}>
    <CopyButtonLabel {...labelProps} />
  </button>
);
