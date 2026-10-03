interface ErrorAlertProps {
  readonly message: string | null;
  /** Margin classes, each followed by a space (e.g. `"mt-3 "`). */
  readonly spacingClassName?: string;
}

/** Announced red error box; renders nothing while `message` is null. */
export function ErrorAlert({
  message, spacingClassName = ''
}: ErrorAlertProps) {
  if (message === null) return null;
  return (
    <p role="alert" className={`${spacingClassName}rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700`}>
      {message}
    </p>
  );
}
