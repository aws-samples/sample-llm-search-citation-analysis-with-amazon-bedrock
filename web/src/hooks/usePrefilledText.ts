import { useState } from 'react';

/**
 * A text field that starts from a Settings value: `fallback` is shown until the user types, and from then on what
 * they typed is kept (clearing the field included), even when `fallback` arrives or changes later.
 */
export function usePrefilledText(fallback: string): readonly [string, (value: string) => void] {
  const [typed, setTyped] = useState<string | null>(null);
  return [typed ?? fallback, setTyped];
}
