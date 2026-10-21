/** A bounded read's cut (`truncated_before` and kin): a run timestamp, `null`, or absent from older API builds. */
export function isTruncationMark(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string';
}
