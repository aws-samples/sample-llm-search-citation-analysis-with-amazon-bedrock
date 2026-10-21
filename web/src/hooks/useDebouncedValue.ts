import {
  useEffect, useState
} from 'react';

/** `value`, once it has stayed the same for `delayMs` (so typing does not send a request per keystroke). */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
