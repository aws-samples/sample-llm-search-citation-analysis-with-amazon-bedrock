class InvalidContentStudioResponseError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidContentStudioResponseError';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

export function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

export function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return value === undefined || isStringArray(value);
}

export function isAllowedString<TValue extends string>(
  value: unknown,
  allowed: readonly TValue[]
): value is TValue {
  return allowed.some((candidate) => candidate === value);
}

export function invalid(field: string): InvalidContentStudioResponseError {
  return new InvalidContentStudioResponseError(
    `Content Studio API returned an invalid ${field}`
  );
}

export function decodeInteger(value: unknown, field: string): number {
  const parsed = typeof value === 'string' && /^\d+$/u.test(value)
    ? Number(value)
    : value;
  // Stryker disable next-line ConditionalExpression: Number.isSafeInteger rejects every non-number before the range check, so removing this type guard is equivalent.
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw invalid(field);
  }
  return parsed;
}

export function optionalInteger(value: unknown, field: string): number | undefined {
  return value === undefined ? undefined : decodeInteger(value, field);
}


export function optionalResponseString(value: unknown): string | undefined {
  // Stryker disable next-line ConditionalExpression: Decoder callers validate this optional field before narrowing it for TypeScript, so the fallback is unreachable.
  return typeof value === 'string' ? value : undefined;
}

export function optionalResponseBoolean(value: unknown): boolean | undefined {
  // Stryker disable next-line ConditionalExpression: Decoder callers validate this optional field before narrowing it for TypeScript, so the fallback is unreachable.
  return typeof value === 'boolean' ? value : undefined;
}


export function isFiniteNumber(value: unknown): value is number {
  // Stryker disable next-line ConditionalExpression: Number.isFinite rejects non-numbers without coercion, making this explicit type guard equivalent at runtime.
  return typeof value === 'number' && Number.isFinite(value);
}
