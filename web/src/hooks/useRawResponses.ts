import {
  useState, useCallback 
} from 'react';
import {
  API_BASE_URL, authenticatedFetch, getErrorMessage 
} from '../infrastructure';
import type {
  S3BrowseResponse, RawResponseContent 
} from '../types';

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
  const url = `${API_BASE_URL}/raw-responses/${request.endpoint}?${request.param}=${encodeURIComponent(request.value)}&bucket=${request.bucket}`;
  const response = await authenticatedFetch(url);
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

  const reportFailure = useCallback((err: unknown, action: string): null => {
    setError(getErrorMessage(err, 'rawResponses'));
    console.error(`[rawResponses] Error ${action}:`, err);
    return null;
  }, []);

  /** A browse or file read: shows the spinner, clears the last error and stores the payload it gets. */
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

  const browse = useCallback(async (prefix = '', bucket: BucketType = 'responses') => load({
    endpoint: 'browse',
    param: 'prefix',
    value: prefix,
    bucket,
  }, isS3BrowseResponse, setBrowseData, 'browsing'), [load]);

  const getFile = useCallback(async (key: string, bucket: BucketType = 'responses') => load({
    endpoint: 'file',
    param: 'key',
    value: key,
    bucket,
  }, isRawResponseContent, setFileContent, 'getting file'), [load]);

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

  const clearFile = useCallback(() => {
    setFileContent(null);
  }, []);

  return {
    loading,
    error,
    browseData,
    fileContent,
    browse,
    getFile,
    getDownloadUrl,
    clearFile,
  };
};
