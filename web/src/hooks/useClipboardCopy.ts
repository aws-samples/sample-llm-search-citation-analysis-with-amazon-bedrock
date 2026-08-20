import {
  useCallback, useEffect, useRef, useState
} from 'react';

const COPIED_INDICATOR_MS = 2000;

/**
 * Clipboard copy with a transient "copied" indicator (bugs.md 4.4 — the
 * writeText + 2s-setTimeout pattern was previously copied six times, one of
 * them as an unhandled floating promise).
 *
 * `copied` holds the key passed to `copy` for two seconds, so callers with
 * several copy targets can key their indicators (`copied === 'body'`);
 * single-target callers can test truthiness. `copy` never rejects — when the
 * clipboard is unavailable the indicator simply does not show — so
 * fire-and-forget call sites can safely `void copy(...)`.
 */
export function useClipboardCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(async (text: string, key = 'copied') => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard unavailable (permissions / insecure context): show no
      // false "copied" indicator and never surface a rejection.
      return;
    }

    setCopied(key);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setCopied(null);
      timerRef.current = null;
    }, COPIED_INDICATOR_MS);
  }, []);

  return {
    copied,
    copy,
  };
}
