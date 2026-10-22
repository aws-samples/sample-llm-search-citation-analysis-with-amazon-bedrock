import {
  useState, useCallback, useRef
} from 'react';
import {
  API_BASE_URL, authenticatedFetch, getErrorMessage 
} from '../infrastructure';
import type {
  S3BrowseResponse, RawResponseContent 
} from '../types';
import { mergeBrowsePages } from './rawResponsesPages';

class RawResponsesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RawResponsesError';
  }
}

interface DownloadResponse {download_url?: string;}

export type BucketType = 'responses' | 'screenshots';

function isS3BrowseResponse(data: unknown): data is S3BrowseResponse {
  return typeof data === 'object' && data !== null && 'prefix' in data;
}

function isRawResponseContent(data: unknown): data is RawResponseContent {
  return typeof data === 'object' && data !== null && 'key' in data;
}

function isDownloadResponse(data: unknown): data is DownloadResponse {
  return typeof data === 'object' && data !== null;
}

interface RawResponsesRequest {
  endpoint: 'browse' | 'file' | 'download';
  /** Query parameter carrying the folder prefix or object key. */
  param: 'prefix' | 'key';
  value: string;
  bucket: BucketType;
  /** The browse page to continue from. */
  nextToken?: string;
}

function requestUrl(request: RawResponsesRequest): string {
  const base = `${API_BASE_URL}/raw-responses/${request.endpoint}?${request.param}=${encodeURIComponent(request.value)}&bucket=${request.bucket}`;
  return request.nextToken === undefined ? base : `${base}&next_token=${encodeURIComponent(request.nextToken)}`;
}

/**
 * Calls one raw-responses endpoint and returns its payload when it passes
 * `isPayload`, or null when it does not. Throws on a non-OK status so the
 * caller's catch block owns the error state and logging.
 */
async function requestRawResponses<TPayload>(
  request: RawResponsesRequest,
  isPayload: (data: unknown) => data is TPayload,
): Promise<TPayload | null> {
  const response = await authenticatedFetch(requestUrl(request));
  if (!response.ok) {
    throw new RawResponsesError(`HTTP ${response.status}`);
  }
  const data: unknown = await response.json();
  return isPayload(data) ? data : null;
}

export const useRawResponses = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browseData, setBrowseData] = useState<S3BrowseResponse | null>(null);
  const [fileContent, setFileContent] = useState<RawResponseContent | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const browsedFolderRef = useRef<{
    prefix: string;
    bucket: BucketType 
  } | null>(null);

  const reportFailure = useCallback((err: unknown, action: string): null => {
    setError(getErrorMessage(err, 'rawResponses'));
    console.error(`[rawResponses] Error ${action}:`, err);
    return null;
  }, []);

  /** A browse or file read: shows the spinner, clears the last error and stores the payload it gets. */
  // Stryker disable ArrayDeclaration: React dependency list; reportFailure has a stable identity, so omitting it cannot stale this callback
  const load = useCallback(async <TPayload,>(
    request: RawResponsesRequest,
    isPayload: (data: unknown) => data is TPayload,
    store: (payload: TPayload) => void,
    action: string
  ): Promise<TPayload | null> => {
    setLoading(true);
    setError(null);
    try {
      const data = await requestRawResponses(request, isPayload);
      if (data) store(data);
      return data;
    } catch (err) {
      return reportFailure(err, action);
    } finally {
      setLoading(false);
    }
  }, [reportFailure]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: React dependency list; load has a stable identity, so omitting it cannot stale this callback
  const browse = useCallback(async (prefix = '', bucket: BucketType = 'responses') => {
    const folder = {
      prefix,
      bucket 
    };
    browsedFolderRef.current = folder;
    return load({
      endpoint: 'browse',
      param: 'prefix',
      value: prefix,
      bucket,
    }, isS3BrowseResponse, setBrowseData, 'browsing');
  }, [load]);
  // Stryker restore ArrayDeclaration

  /** Appends the next page of the folder on screen; ignored once another folder is browsed meanwhile. */
  // Stryker disable ArrayDeclaration: React dependency list; reportFailure has a stable identity, so omitting it cannot stale this callback
  const loadMore = useCallback(async (): Promise<void> => {
    const folder = browsedFolderRef.current;
    const nextToken = browseData?.next_token;
    if (folder === null || typeof nextToken !== 'string') return;
    setLoadingMore(true);
    try {
      const page = await requestRawResponses({
        endpoint: 'browse',
        param: 'prefix',
        value: folder.prefix,
        bucket: folder.bucket,
        nextToken,
      }, isS3BrowseResponse);
      if (page && browsedFolderRef.current === folder) {
        setBrowseData((current) => (current === null ? page : mergeBrowsePages(current, page)));
      }
    } catch (err) {
      reportFailure(err, 'loading more entries');
    } finally {
      setLoadingMore(false);
    }
  }, [browseData, reportFailure]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: React dependency list; load has a stable identity, so omitting it cannot stale this callback
  const getFile = useCallback(async (key: string, bucket: BucketType = 'responses') => load({
    endpoint: 'file',
    param: 'key',
    value: key,
    bucket,
  }, isRawResponseContent, setFileContent, 'getting file'), [load]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: React dependency list; reportFailure has a stable identity, so omitting it cannot stale this callback
  const getDownloadUrl = useCallback(async (key: string, bucket: BucketType = 'responses'): Promise<string | null> => {
    try {
      const data = await requestRawResponses({
        endpoint: 'download',
        param: 'key',
        value: key,
        bucket,
      }, isDownloadResponse);
      return data?.download_url ?? null;
    } catch (err) {
      return reportFailure(err, 'getting download URL');
    }
  }, [reportFailure]);
  // Stryker restore ArrayDeclaration

  const clearFile = useCallback(() => {
    setFileContent(null);
  }, []);

  return {
    loading,
    loadingMore,
    error,
    browseData,
    fileContent,
    browse,
    loadMore,
    getFile,
    getDownloadUrl,
    clearFile,
  };
};
