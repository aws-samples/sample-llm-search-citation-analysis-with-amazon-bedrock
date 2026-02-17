import {
  useState, useCallback, useEffect, useRef
} from 'react';
import {
  API_BASE_URL,
  authenticatedFetch,
  getErrorMessage,
  ApiRequestError,
} from '../infrastructure';
import type {
  ContentIdea, ContentStudioHistory 
} from '../types';

/** Polling interval for checking generating status (10 seconds) */
const GENERATING_POLL_INTERVAL = 10000;

/** @internal Response from the content ideas API */
interface ContentIdeasResponse {
  ideas: ContentIdea[];
  total_count: number;
  generated_at: string;
}

/** @internal Response from the content generation API */
interface GenerateContentResponse {
  success: boolean;
  id: string;
  status: 'pending' | 'generating' | 'generated' | 'failed';
  message?: string;
  keyword: string;
  error?: string;
}

/** @internal Response from the content history API */
interface ContentHistoryResponse {
  history: ContentStudioHistory[];
  total_count: number;
  unviewed_count: number;
}

function isContentIdeasResponse(data: unknown): data is ContentIdeasResponse {
  return typeof data === 'object' && data !== null && 'ideas' in data;
}

function isGenerateContentResponse(data: unknown): data is GenerateContentResponse {
  return typeof data === 'object' && data !== null && 'id' in data && 'status' in data;
}

function isContentHistoryResponse(data: unknown): data is ContentHistoryResponse {
  return typeof data === 'object' && data !== null && 'history' in data;
}

/** @internal Response from the content status API */
interface ContentStatusResponse {
  id: string;
  status: 'pending' | 'generating' | 'generated' | 'failed';
  keyword?: string;
  created_at?: string;
  updated_at?: string;
  has_content?: boolean;
  error_message?: string;
}

function isContentStatusResponse(data: unknown): data is ContentStatusResponse {
  return typeof data === 'object' && data !== null && 'id' in data && 'status' in data;
}

/**
 * Hook for Content Studio functionality.
 * Provides content ideas based on visibility gaps and AI-powered content generation.
 * 
 * @returns Object containing:
 * - `ideas` - List of content ideas based on visibility analysis
 * - `history` - Previously generated content
 * - `unviewedCount` - Number of unviewed generated content items
 * - `loading` - Whether ideas/history are being fetched
 * - `generating` - Whether content is being generated
 * - `error` - Error message if operation failed
 * - `fetchIdeas` - Function to fetch content ideas
 * - `generateContent` - Function to generate content for an idea
 * - `fetchHistory` - Function to fetch generation history
 * - `markViewed` - Function to mark content as viewed
 * - `deleteContent` - Function to delete generated content
 * 
 * @example
 * ```tsx
 * const { ideas, generateContent, generating, unviewedCount } = useContentStudio();
 * 
 * // Generate content for an idea
 * const result = await generateContent(ideas[0]);
 * if (result?.success) {
 *   console.log('Content generation started:', result.id);
 * }
 * ```
 */
export function useContentStudio() {
  const [ideas, setIdeas] = useState<ContentIdea[]>([]);
  const [history, setHistory] = useState<ContentStudioHistory[]>([]);
  const [unviewedCount, setUnviewedCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Check status of a single content item */
  const checkContentStatus = useCallback(async (id: string): Promise<ContentStatusResponse | null> => {
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/content-studio/status/${id}`);
      if (!response.ok) return null;
      
      const json: unknown = await response.json();
      if (!isContentStatusResponse(json)) return null;
      return json;
    } catch {
      return null;
    }
  }, []);

  const fetchHistory = useCallback(async (limit = 20): Promise<ContentStudioHistory[]> => {
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams({ limit: limit.toString() });
      const response = await authenticatedFetch(`${API_BASE_URL}/content-studio/history?${params}`);
      if (!response.ok) throw new ApiRequestError(`HTTP ${response.status}`, response.status);
      
      const json: unknown = await response.json();
      if (!isContentHistoryResponse(json)) {
        throw new ApiRequestError('Invalid response format');
      }
      setHistory(json.history);
      setUnviewedCount(json.unviewed_count);
      return json.history;
    } catch (err) {
      const message = getErrorMessage(err, 'content');
      setError(message);
      console.error('[content] Error fetching history:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  /** Poll for status updates on generating items */
  const pollGeneratingItems = useCallback(async () => {
    const generatingItems = history.filter(
      item => item.status === 'pending' || item.status === 'generating'
    );
    
    if (generatingItems.length === 0) {
      // No items to poll, clear interval
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    const completedItems = await Promise.all(
      generatingItems.map(async (item) => {
        const status = await checkContentStatus(item.id);
        return status && status.status !== item.status && 
          (status.status === 'generated' || status.status === 'failed');
      })
    );

    // If any items completed, fetch full history to get generated_content
    if (completedItems.some(Boolean)) {
      await fetchHistory();
    }
  }, [history, checkContentStatus, fetchHistory]);

  // Set up polling when there are generating items
  useEffect(() => {
    const hasGeneratingItems = history.some(
      item => item.status === 'pending' || item.status === 'generating'
    );

    if (hasGeneratingItems && !pollingRef.current) {
      // Start polling
      pollingRef.current = setInterval(pollGeneratingItems, GENERATING_POLL_INTERVAL);
      // Also poll immediately
      pollGeneratingItems();
    } else if (!hasGeneratingItems && pollingRef.current) {
      // Stop polling
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [history, pollGeneratingItems]);

  const fetchIdeas = useCallback(async (): Promise<ContentIdea[]> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/content-studio/ideas`);
      if (!response.ok) throw new ApiRequestError('Failed to fetch content ideas', response.status);
      
      const json: unknown = await response.json();
      if (!isContentIdeasResponse(json)) {
        throw new ApiRequestError('Invalid response format');
      }
      setIdeas(json.ideas);
      return json.ideas;
    } catch (err) {
      const message = getErrorMessage(err, 'content');
      setError(message);
      console.error('[content] Error fetching ideas:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const generateContent = useCallback(async (idea: ContentIdea): Promise<GenerateContentResponse | null> => {
    setGenerating(true);
    setError(null);
    
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/content-studio/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea })
      });
      
      const json: unknown = await response.json();
      if (!isGenerateContentResponse(json)) {
        throw new ApiRequestError('Invalid response format');
      }
      
      if (!response.ok) {
        throw new ApiRequestError(json.error ?? `HTTP ${response.status}`, response.status);
      }
      
      // Refresh history to get the new content
      await fetchHistory();
      
      return json;
    } catch (err) {
      const message = getErrorMessage(err, 'content');
      setError(message);
      console.error('[content] Error generating content:', err);
      return null;
    } finally {
      setGenerating(false);
    }
  }, [fetchHistory]);

  const markViewed = useCallback(async (id: string): Promise<boolean> => {
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/content-studio/viewed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      
      if (!response.ok) throw new ApiRequestError(`HTTP ${response.status}`, response.status);
      
      // Update local state
      setHistory(prev => prev.map(item => 
        item.id === id ? {
          ...item,
          viewed: true 
        } : item
      ));
      setUnviewedCount(prev => Math.max(0, prev - 1));
      
      return true;
    } catch (err) {
      console.error('[content] Error marking content as viewed:', err);
      return false;
    }
  }, []);

  const deleteContent = useCallback(async (id: string): Promise<boolean> => {
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/content-studio/${id}`, {method: 'DELETE'});
      
      if (!response.ok) throw new ApiRequestError(`HTTP ${response.status}`, response.status);
      
      // Remove from local state and update unviewed count if needed
      const deletedItem = history.find(item => item.id === id);
      setHistory(prev => prev.filter(item => item.id !== id));
      if (deletedItem && !deletedItem.viewed) {
        setUnviewedCount(prev => Math.max(0, prev - 1));
      }
      
      return true;
    } catch (err) {
      const message = getErrorMessage(err, 'content');
      setError(message);
      console.error('[content] Error deleting content:', err);
      return false;
    }
  }, [history]);

  /** Manually trigger a poll for generating items */
  const refreshGeneratingItems = useCallback(() => {
    pollGeneratingItems();
  }, [pollGeneratingItems]);

  return {
    ideas,
    history,
    unviewedCount,
    loading,
    generating,
    error,
    fetchIdeas,
    generateContent,
    fetchHistory,
    markViewed,
    deleteContent,
    refreshGeneratingItems
  };
}
