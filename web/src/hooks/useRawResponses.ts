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

export const useRawResponses = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browseData, setBrowseData] = useState<S3BrowseResponse | null>(null);
  const [fileContent, setFileContent] = useState<RawResponseContent | null>(null);

  const browse = useCallback(async (prefix = '', bucket: BucketType = 'responses') => {
    setLoading(true);
    setError(null);
    try {
      const url = `${API_BASE_URL}/raw-responses/browse?prefix=${encodeURIComponent(prefix)}&bucket=${bucket}`;
      const response = await authenticatedFetch(url);
      if (!response.ok) {
        throw new RawResponsesError(`HTTP ${response.status}`);
      }
      const data: unknown = await response.json();
      if (isS3BrowseResponse(data)) {
        setBrowseData(data);
        return data;
      }
      return null;
    } catch (err) {
      const message = getErrorMessage(err, 'rawResponses');
      setError(message);
      console.error('[rawResponses] Error browsing:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const getFile = useCallback(async (key: string, bucket: BucketType = 'responses') => {
    setLoading(true);
    setError(null);
    try {
      const url = `${API_BASE_URL}/raw-responses/file?key=${encodeURIComponent(key)}&bucket=${bucket}`;
      const response = await authenticatedFetch(url);
      if (!response.ok) {
        throw new RawResponsesError(`HTTP ${response.status}`);
      }
      const data: unknown = await response.json();
      if (isRawResponseContent(data)) {
        setFileContent(data);
        return data;
      }
      return null;
    } catch (err) {
      const message = getErrorMessage(err, 'rawResponses');
      setError(message);
      console.error('[rawResponses] Error getting file:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const getDownloadUrl = useCallback(async (key: string, bucket: BucketType = 'responses'): Promise<string | null> => {
    try {
      const url = `${API_BASE_URL}/raw-responses/download?key=${encodeURIComponent(key)}&bucket=${bucket}`;
      const response = await authenticatedFetch(url);
      if (!response.ok) {
        throw new RawResponsesError(`HTTP ${response.status}`);
      }
      const data: unknown = await response.json();
      if (isDownloadResponse(data)) {
        return data.download_url ?? null;
      }
      return null;
    } catch (err) {
      const message = getErrorMessage(err, 'rawResponses');
      setError(message);
      console.error('[rawResponses] Error getting download URL:', err);
      return null;
    }
  }, []);

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
