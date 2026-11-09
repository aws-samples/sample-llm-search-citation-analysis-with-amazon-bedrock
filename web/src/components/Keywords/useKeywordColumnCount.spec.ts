import { renderHook } from '@testing-library/react';
import {
  afterEach, describe, expect, it, vi
} from 'vitest';
import { useKeywordColumnCount } from './useKeywordColumnCount';

function stubViewportWidth(width: number): void {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: width >= Number(/\d+/u.exec(query)?.[0]),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useKeywordColumnCount', () => {
  it.each([
    [375, false, 4],
    [375, true, 5],
    [1024, true, 6],
    [1600, true, 7],
    [1600, false, 6],
  ])('counts the columns shown %ipx wide (market column: %s)', (width, showMarket, expected) => {
    stubViewportWidth(width);

    expect(renderHook(() => useKeywordColumnCount(showMarket)).result.current).toBe(expected);
  });
});
