import {
  useId, type ReactNode
} from 'react';
import { Button } from '../ui';
import { Spinner } from '../ui/Spinner';
import { StrokeIcon } from '../ui/StrokeIcon';

interface ConfigSectionProps {
  readonly title: ReactNode;
  /** One plain sentence under the title. */
  readonly description: ReactNode;
  /** Secondary actions on the right of the title. */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}

/** A titled part of the Brand Tracking form: heading, one-line explanation, actions, then the fields. */
export function ConfigSection({
  title, description, actions, children
}: ConfigSectionProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-4 border-t border-gray-200 pt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 id={headingId} className="flex items-center gap-2 text-base font-semibold text-gray-900">{title}</h3>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">{description}</p>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

interface SuggestButtonProps {
  readonly label: string;
  readonly busyLabel: string;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly iconPaths: readonly string[];
  readonly onClick: () => void;
}

/** A secondary "ask Bedrock for suggestions" button; it shows a spinner while its own request runs. */
export function SuggestButton({
  label, busyLabel, busy, disabled, iconPaths, onClick
}: SuggestButtonProps) {
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => onClick()}
      disabled={disabled}
      leadingIcon={busy ? <Spinner size="sm" /> : <StrokeIcon className="h-4 w-4" paths={iconPaths} strokeWidth={2} />}
    >
      {busy ? busyLabel : label}
    </Button>
  );
}
