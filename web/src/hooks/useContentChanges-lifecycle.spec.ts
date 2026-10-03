import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  renderHook, waitFor
} from '@testing-library/react';
import { ApiRequestError } from '../infrastructure';
import type {
  ContentChangeMarker, ContentChangesResponse
} from '../types';
import {
  buildContentChangeMarker,
  buildContentChangesResponse,
} from '../types/domain/alerts-fixtures';
import {
  createContentChange as mockCreateContentChange,
  fetchContentChanges as mockFetchContentChanges,
  prepareAlertHookTest,
} from './alertsApiMock-fixtures';
import { AlertHookFailure } from './alertHookErrors-fixtures';
import {
  CONTENT_CHANGE_REQUEST,
  beginContentChangeRecord,
  beginRecordThenSwitchGroup,
  deferNextCall,
  rejectDeferredValue,
  renderContentChangesForGroup,
  renderLoadedContentChanges,
  resolveDeferredValue,
} from './useAlerts-fixtures';
import { deferNextTwoCalls } from '../test/fetchResponses';
import { useContentChanges } from './useAlerts';

vi.mock('../api/alerts', () => import('./alertsApiMock-fixtures'));

beforeEach(prepareAlertHookTest);

describe('useContentChanges lifecycle', () => {
  it('starts idle without marker or record activity when no group is selected', () => {
    const { result } = renderHook(() => useContentChanges(''));

    expect({
      latestMarker: result.current.latestMarker,
      loading: result.current.loading,
      error: result.current.error,
      recording: result.current.recording,
      recordOutcome: result.current.recordOutcome,
    }).toStrictEqual({
      latestMarker: null,
      loading: false,
      error: null,
      recording: false,
      recordOutcome: null,
    });
  });

  it('cancels a pending marker load and returns to idle when selection is cleared', async () => {
    const response = deferNextCall<ContentChangesResponse>(mockFetchContentChanges);
    const {
      result, rerender
    } = renderContentChangesForGroup();
    await waitFor(() => expect(mockFetchContentChanges).toHaveBeenCalledTimes(1));
    const signal = mockFetchContentChanges.mock.calls[0][0].signal;

    rerender({ selectedGroupId: '' });

    expect({
      aborted: signal?.aborted,
      loading: result.current.loading,
      error: result.current.error,
      latestMarker: result.current.latestMarker,
    }).toStrictEqual({
      aborted: true,
      loading: false,
      error: null,
      latestMarker: null,
    });

    response.resolve(buildContentChangesResponse());
  });

  it('clears the previous marker and record outcome when the selected group changes', async () => {
    const marker = buildContentChangeMarker();
    mockCreateContentChange.mockResolvedValueOnce(marker);
    const {
      result, rerender
    } = renderContentChangesForGroup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    await beginContentChangeRecord(result.current);
    const southLoad = deferNextCall<ContentChangesResponse>(mockFetchContentChanges);

    rerender({ selectedGroupId: 'group-south' });

    expect(result.current.latestMarker).toBeNull();
    expect(result.current.recordOutcome).toBeNull();
    expect(result.current.recording).toBe(false);
    southLoad.resolve(buildContentChangesResponse());
  });

  it('aborts marker loading and enters recording state when a record starts', async () => {
    const loadResponse = deferNextCall<ContentChangesResponse>(mockFetchContentChanges);
    const recordResponse = deferNextCall<ContentChangeMarker>(mockCreateContentChange);
    const { result } = renderContentChangesForGroup();
    await waitFor(() => expect(mockFetchContentChanges).toHaveBeenCalledTimes(1));
    const loadSignal = mockFetchContentChanges.mock.calls[0][0].signal;

    const pendingRecord = beginContentChangeRecord(result.current);

    expect({
      aborted: loadSignal?.aborted,
      loading: result.current.loading,
      recording: result.current.recording,
      recordOutcome: result.current.recordOutcome,
    }).toStrictEqual({
      aborted: true,
      loading: false,
      recording: true,
      recordOutcome: null,
    });

    loadResponse.resolve(buildContentChangesResponse());
    await resolveDeferredValue(recordResponse, buildContentChangeMarker(), pendingRecord);
  });

  it('clears a load error while a content-change record is pending', async () => {
    mockFetchContentChanges.mockRejectedValueOnce(new ApiRequestError('HTTP 500', 500));
    const { result } = await renderLoadedContentChanges();
    const recordResponse = deferNextCall<ContentChangeMarker>(mockCreateContentChange);

    const pendingRecord = beginContentChangeRecord(result.current);

    expect(result.current.error).toBeNull();
    expect(result.current.recording).toBe(true);

    await resolveDeferredValue(recordResponse, buildContentChangeMarker(), pendingRecord);
  });

  it('stores the exact failure when recording fails for the selected group', async () => {
    mockCreateContentChange.mockRejectedValueOnce(new AlertHookFailure());
    const { result } = await renderLoadedContentChanges();

    const outcome = await beginContentChangeRecord(result.current);

    expect(outcome).toStrictEqual({
      success: false,
      message: 'Failed to process alert request',
    });
    await waitFor(() => expect(result.current.recordOutcome).toStrictEqual(outcome));
    expect(result.current.recording).toBe(false);
  });

  it('does not apply an old recorded marker after the selected group changes', async () => {
    const northMarker = buildContentChangeMarker({ group_id: 'group-north' });
    const southMarker = buildContentChangeMarker({
      id: 'change-south',
      group_id: 'group-south',
    });
    mockFetchContentChanges
      .mockResolvedValueOnce(buildContentChangesResponse({ items: [northMarker] }))
      .mockResolvedValueOnce(buildContentChangesResponse({ items: [southMarker] }));
    const oldRecord = deferNextCall<ContentChangeMarker>(mockCreateContentChange);
    const {
      result, rerender
    } = renderContentChangesForGroup();
    await waitFor(() => expect(result.current.latestMarker).toStrictEqual(northMarker));
    const pendingRecord = beginContentChangeRecord(result.current);

    rerender({ selectedGroupId: 'group-south' });
    await waitFor(() => expect(result.current.latestMarker).toStrictEqual(southMarker));
    await resolveDeferredValue(oldRecord, northMarker, pendingRecord);

    expect(result.current.latestMarker).toStrictEqual(southMarker);
    expect(result.current.recordOutcome).toBeNull();
  });

  it('does not apply an old record failure after the selected group changes', async () => {
    const oldRecord = deferNextCall<ContentChangeMarker>(mockCreateContentChange);
    const {
      result, pendingRecord
    } = await beginRecordThenSwitchGroup();
    await rejectDeferredValue(oldRecord, new AlertHookFailure(), pendingRecord);

    expect(result.current.recordOutcome).toBeNull();
  });

  it('keeps a new-group record pending when the old-group record settles', async () => {
    const [oldRecord, currentRecord] = deferNextTwoCalls<ContentChangeMarker>(mockCreateContentChange);
    const {
      result, pendingRecord: oldPending
    } = await beginRecordThenSwitchGroup();
    const currentRequest = {
      ...CONTENT_CHANGE_REQUEST,
      group_id: 'group-south',
    };
    const currentPending = beginContentChangeRecord(result.current, currentRequest);

    await resolveDeferredValue(
      oldRecord,
      buildContentChangeMarker({ group_id: 'group-north' }),
      oldPending
    );

    expect(result.current.recording).toBe(true);

    await resolveDeferredValue(
      currentRecord,
      buildContentChangeMarker({ group_id: 'group-south' }),
      currentPending
    );
  });
});
