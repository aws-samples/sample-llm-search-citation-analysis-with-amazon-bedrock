import {
  act, renderHook
} from '@testing-library/react';
import {
  describe, expect, it
} from 'vitest';
import { usePrefilledText } from './usePrefilledText';

/** The hook with `fallback` as the Settings value; `rerender({ fallback })` changes it. */
function renderPrefilled(fallback: string) {
  return renderHook((props: { fallback: string }) => usePrefilledText(props.fallback), { initialProps: { fallback } });
}

describe('usePrefilledText', () => {
  it('returns the Settings value before the user types', () => {
    const { result } = renderPrefilled('Example');

    expect(result.current[0]).toBe('Example');
  });

  it('follows the Settings value when it arrives after the first render', () => {
    const hook = renderPrefilled('');

    hook.rerender({ fallback: 'Example' });

    expect(hook.result.current[0]).toBe('Example');
  });

  it('keeps what the user typed when the Settings value changes', () => {
    const hook = renderPrefilled('Example');

    act(() => { hook.result.current[1]('Other'); });
    hook.rerender({ fallback: 'Renamed' });

    expect(hook.result.current[0]).toBe('Other');
  });

  it('keeps a field the user emptied empty', () => {
    const { result } = renderPrefilled('Example');

    act(() => { result.current[1](''); });

    expect(result.current[0]).toBe('');
  });
});
