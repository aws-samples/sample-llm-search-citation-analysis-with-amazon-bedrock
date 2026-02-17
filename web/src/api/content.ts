/**
 * Content Studio API client functions.
 */
import {
  apiGet, apiPost, apiDelete 
} from './client';
import type {
  ContentIdea, ContentStudioHistory 
} from '../types';

interface ContentHistoryResponse {items: ContentStudioHistory[];}

/**
 * Fetches content generation history.
 */
export async function fetchContentHistory(
  limit = 50,
  signal?: AbortSignal
): Promise<ContentStudioHistory[]> {
  const response = await apiGet<ContentHistoryResponse>('/content-studio/history', {
    params: { limit: limit.toString() },
    signal,
  });
  return response.items ?? [];
}

interface ContentIdeasResponse {ideas: ContentIdea[];}

/**
 * Fetches content ideas based on visibility analysis.
 */
export async function fetchContentIdeas(signal?: AbortSignal): Promise<ContentIdea[]> {
  const response = await apiGet<ContentIdeasResponse>('/content-studio/ideas', { signal });
  return response.ideas ?? [];
}

interface GenerateContentOptions {
  keyword: string;
  ideaType: string;
  ideaTitle: string;
  contentAngle: string;
  competitorUrls?: string[];
  signal?: AbortSignal;
}

/**
 * Generates content based on a content idea.
 */
export function generateContent(
  options: GenerateContentOptions
): Promise<ContentStudioHistory> {
  const {
    keyword, ideaType, ideaTitle, contentAngle, competitorUrls = [], signal 
  } = options;
  return apiPost<ContentStudioHistory>(
    '/content-studio/generate',
    {
      keyword,
      idea_type: ideaType,
      idea_title: ideaTitle,
      content_angle: contentAngle,
      competitor_urls: competitorUrls,
    },
    { signal }
  );
}

/**
 * Marks a content item as viewed.
 */
export function markContentViewed(id: string): Promise<{ success: boolean }> {
  return apiPost<{ success: boolean }>('/content-studio/viewed', { id });
}

/**
 * Deletes a content item.
 */
export function deleteContent(id: string): Promise<{ message: string }> {
  return apiDelete<{ message: string }>(`/content-studio/${id}`);
}
