import {
  describe, expect, it, vi
} from 'vitest';
import {
  act, renderHook
} from '@testing-library/react';
import { useExportAction } from './useExportAction';

class ExportFailedError extends Error {
  constructor() {
    super('Export failed');
    this.name = 'ExportFailedError';
  }
}

describe('useExportAction', () => {
  it('reports nothing when there is nothing to export yet', async () => {
    const onFailure = vi.fn();
    const { result } = renderHook(() => useExportAction(null, onFailure));

    await act(() => result.current.handleExport());

    expect(onFailure).not.toHaveBeenCalledWith(expect.anything());
  });

  it('hands a failed export to the failure callback', async () => {
    const onFailure = vi.fn();
    const failure = new ExportFailedError();
    const { result } = renderHook(() => useExportAction(() => Promise.reject(failure), onFailure));

    await act(() => result.current.handleExport());

    expect(onFailure).toHaveBeenCalledWith(failure);
  });

  it('logs a failed export under the console prefix', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const failure = new ExportFailedError();
    const { result } = renderHook(() => useExportAction(() => Promise.reject(failure), '[export] Failed:'));

    await act(() => result.current.handleExport());

    expect(consoleError).toHaveBeenCalledWith('[export] Failed:', failure);
  });

  it('releases the button after the export settles', async () => {
    const { result } = renderHook(() => useExportAction(() => Promise.resolve(), '[export] Failed:'));

    await act(() => result.current.handleExport());

    expect(result.current.exporting).toBe(false);
  });
});
