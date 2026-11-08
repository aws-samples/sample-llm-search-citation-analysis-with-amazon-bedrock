/**
 * Replacement for `api/exports` in view specs that check what a view's "Export all" asks for:
 *
 * ```ts
 * vi.mock('../../api/exports', () => import('../../test/exportsApiMock'));
 * import { mockStartExport } from '../../test/exportsApiMock';
 * ...
 * await chooseExportFormat('xlsx');
 * expect(mockStartExport).toHaveBeenCalledWith({ view: 'citations', params: {...}, format: 'xlsx' });
 * ```
 *
 * `startExport` and the other network calls are `vi.fn()`; `exportParams` and the status
 * helpers are the real ones, so the spec sees exactly the params the button sends.
 */
import {
  vi, expect 
} from 'vitest';
import {
  fireEvent, screen, waitFor
} from '@testing-library/react';
import type * as ExportsApi from '../api/exports';
import { buildExportSummary } from '../types/domain/exports-fixtures';

const actual = await vi.importActual<typeof ExportsApi>('../api/exports');

export const {
  exportParams, isExportActive, isUnseenFinish, requestParams
} = actual;

export const mockStartExport = vi.fn<typeof ExportsApi.startExport>(
  (request) => Promise.resolve(buildExportSummary({
    view: request.view,
    params: { ...request.params },
    format: request.format,
    status: 'queued',
  })),
);
export const mockListExports = vi.fn<typeof ExportsApi.listExports>(() => Promise.resolve({
  exports: [],
  next_token: null,
}));
export const mockGetExport = vi.fn<typeof ExportsApi.getExport>();
export const mockFetchDownloadUrl = vi.fn<typeof ExportsApi.fetchDownloadUrl>();
export const mockDeleteExport = vi.fn<typeof ExportsApi.deleteExport>(() => Promise.resolve());
export const mockMarkExportSeen = vi.fn<typeof ExportsApi.markExportSeen>(() => Promise.resolve());

export {
  mockStartExport as startExport,
  mockListExports as listExports,
  mockGetExport as getExport,
  mockFetchDownloadUrl as fetchDownloadUrl,
  mockDeleteExport as deleteExport,
  mockMarkExportSeen as markExportSeen,
};

/**
 * Opens the first "Export all" menu on screen (or the first labelled `buttonName`) and picks a
 * format, as a user would; resolves once that button is back (the request settled).
 */
export async function chooseExportFormat(format: 'xlsx' | 'csv', buttonName: string | RegExp = /^Export all$/): Promise<void> {
  const [button] = await screen.findAllByRole('button', { name: buttonName });
  fireEvent.click(button);
  fireEvent.click(screen.getByRole('menuitem', { name: format === 'xlsx' ? 'Excel (.xlsx)' : 'CSV (.csv)' }));
  await waitFor(() => expect(button).toHaveAccessibleName(buttonName));
}
