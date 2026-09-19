import { ClipboardIcon } from '../ui/ClipboardIcon';

interface CopyButtonLabelProps {
  copied: boolean;
  /** Tailwind size classes shared by the clipboard and the check mark. */
  iconClassName: string;
  label: string;
  copiedLabel?: string;
}

/**
 * Icon-plus-text content of a copy-to-clipboard button: a clipboard with the
 * `label` until the copy lands, then a green check mark with `copiedLabel`.
 */
export const CopyButtonLabel = ({
  copied, iconClassName, label, copiedLabel = 'Copied!'
}: CopyButtonLabelProps) => (
  copied ? (
    <>
      <svg className={`${iconClassName} text-green-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
      {copiedLabel}
    </>
  ) : (
    <>
      <ClipboardIcon className={iconClassName} />
      {label}
    </>
  )
);
