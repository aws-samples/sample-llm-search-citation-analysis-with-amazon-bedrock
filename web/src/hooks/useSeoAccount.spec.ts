import {
  describe, expect, it, vi
} from 'vitest';
import {
  renderHook, waitFor
} from '@testing-library/react';
import { useSeoAccount } from './useSeoAccount';
import {
  buildSeoAccount, mockFetchSeoAccount, mockIsSeoApiConfigured
} from './useSeoAccount-fixtures';

vi.mock('../api/seo', () => import('./useSeoAccount-fixtures'));

describe('useSeoAccount', () => {
  it('returns the account once it arrives', async () => {
    mockIsSeoApiConfigured.mockReturnValue(true);
    mockFetchSeoAccount.mockResolvedValue(buildSeoAccount());

    const { result } = renderHook(() => useSeoAccount(true));

    await waitFor(() => expect(result.current.account).toStrictEqual(buildSeoAccount()));
  });

  it('stays idle when it is not enabled', () => {
    mockIsSeoApiConfigured.mockReturnValue(true);

    const { result } = renderHook(() => useSeoAccount(false));

    expect(result.current).toStrictEqual({
      account: null,
      loading: false,
      error: null,
    });
  });

  it('stays idle when the SEO stack is not deployed', () => {
    mockIsSeoApiConfigured.mockReturnValue(false);

    renderHook(() => useSeoAccount(true));

    expect(mockFetchSeoAccount).not.toHaveBeenCalledWith();
  });

  it('reads the account again when the stored key changes', async () => {
    mockIsSeoApiConfigured.mockReturnValue(true);
    mockFetchSeoAccount.mockResolvedValue(buildSeoAccount());
    const { rerender } = renderHook(({ key }) => useSeoAccount(true, key), { initialProps: { key: 'old@example.com' } });

    rerender({ key: 'new@example.com' });

    await waitFor(() => expect(mockFetchSeoAccount).toHaveBeenCalledTimes(2));
  });
});
