import { vi } from 'vitest';
import type {
  ContentIdea, ContentStudioHistory 
} from '../types';

export const mockContentIdea: ContentIdea = {
  id: 'idea-1',
  type: 'visibility_gap',
  priority: 'high',
  title: 'Top Hotels Guide',
  description: 'Focus on unique amenities',
  keyword: 'best hotels',
  source: 'https://example.com/article',
  competitor_brands: ['Marriott'],
  actionable: true,
};

export const mockContentHistory: ContentStudioHistory[] = [
  {
    id: 'content-1',
    keyword: 'best hotels',
    idea_type: 'visibility_gap',
    idea_title: 'Top Hotels Guide',
    content_angle: 'comprehensive_guide',
    generated_content: {
      title: 'Best Hotels Guide',
      meta_description: 'Comprehensive guide to the best hotels',
      body: 'Generated article content',
      suggested_headings: ['Introduction', 'Top Hotels'],
      key_points: ['Unique amenities', 'Location benefits']
    },
    raw_content: 'Generated article content',
    competitor_sources_used: 3,
    status: 'generated',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    viewed: false,
  },
  {
    id: 'content-2',
    keyword: 'luxury resorts',
    idea_type: 'ranking_improvement',
    idea_title: 'Luxury Resorts Review',
    content_angle: 'differentiation',
    generated_content: {
      title: 'Luxury Resorts Review',
      meta_description: 'In-depth luxury resort analysis',
      body: 'Luxury resort content',
      suggested_headings: ['Overview', 'Features'],
      key_points: ['Premium services', 'Exclusive locations']
    },
    raw_content: 'Luxury resort content',
    competitor_sources_used: 2,
    status: 'generating',
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    viewed: true,
  },
];

export function createMockFetch(options: {
  ideasResponse?: { ideas: ContentIdea[] };
  historyResponse?: {
    history: ContentStudioHistory[];
    total_count: number;
    unviewed_count: number 
  };
  generateResponse?: {
    success: boolean;
    id: string;
    status: string;
    keyword: string;
    error?: string 
  };
  statusResponse?: {
    id: string;
    status: string 
  };
  shouldFail?: boolean;
  shouldFailGenerate?: boolean;
} = {}) {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (options.shouldFail) {
      return Promise.resolve({
        ok: false,
        status: 500 
      });
    }

    if (url.includes('/ideas')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(options.ideasResponse ?? {
          ideas: [mockContentIdea],
          total_count: 1,
          generated_at: '2024-01-01' 
        }),
      });
    }

    if (url.includes('/history')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(options.historyResponse ?? {
          history: mockContentHistory,
          total_count: 2,
          unviewed_count: 1 
        }),
      });
    }

    if (url.includes('/generate') && init?.method === 'POST') {
      if (options.shouldFailGenerate) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'Generation failed' }) 
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(options.generateResponse ?? {
          success: true,
          id: 'new-content-1',
          status: 'pending',
          keyword: 'test' 
        }),
      });
    }

    if (url.includes('/status/')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(options.statusResponse ?? {
          id: 'content-1',
          status: 'generated' 
        }),
      });
    }

    if (url.includes('/viewed')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }) 
      });
    }

    if (init?.method === 'DELETE') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }) 
      });
    }

    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}) 
    });
  });
}
