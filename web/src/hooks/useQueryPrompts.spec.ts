/**
 * Tests for useQueryPrompts hook.
 */
import {
  renderHook, act 
} from '@testing-library/react';
import {
  vi, describe, it, expect, beforeEach 
} from 'vitest';
import { useQueryPrompts } from './useQueryPrompts';

// Mock the infrastructure module
vi.mock('../infrastructure', () => ({
  authenticatedFetch: vi.fn(),
  API_BASE_URL: 'https://test-api.example.com/api',
}));

import { authenticatedFetch } from '../infrastructure';

const mockFetch = vi.mocked(authenticatedFetch);

const SAMPLE_PROMPT = {
  id: 'p1',
  name: 'Family Traveler',
  template: 'As a family traveler, find {keyword}',
  enabled: 'true',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function mockResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

describe('useQueryPrompts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockImplementation(() => mockResponse([SAMPLE_PROMPT]));
  });

  it('fetches prompts on mount', async () => {
    const { result } = renderHook(() => useQueryPrompts());

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    expect(mockFetch).toHaveBeenCalledWith('https://test-api.example.com/api/query-prompts');
    expect(result.current.prompts).toHaveLength(1);
    expect(result.current.prompts[0].name).toBe('Family Traveler');
  });

  it('handles fetch error gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useQueryPrompts());

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    expect(result.current.prompts).toHaveLength(0);
    expect(result.current.loading).toBe(false);
  });

  it('creates a prompt and adds to state', async () => {
    const newPrompt = {
      ...SAMPLE_PROMPT,
      id: 'p2',
      name: 'Business' 
    };
    mockFetch
      .mockImplementationOnce(() => mockResponse([SAMPLE_PROMPT]))
      .mockImplementationOnce(() => mockResponse(newPrompt, 201));

    const { result } = renderHook(() => useQueryPrompts());

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    await act(async () => {
      await result.current.createPrompt('Business', 'As a business traveler, find {keyword}');
    });

    expect(result.current.prompts).toHaveLength(2);
  });

  it('deletes a prompt and removes from state', async () => {
    mockFetch
      .mockImplementationOnce(() => mockResponse([SAMPLE_PROMPT]))
      .mockImplementationOnce(() => mockResponse({ message: 'deleted' }));

    const { result } = renderHook(() => useQueryPrompts());

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    await act(async () => {
      await result.current.deletePrompt('p1');
    });

    expect(result.current.prompts).toHaveLength(0);
  });

  it('toggles a prompt and updates state', async () => {
    const toggled = {
      ...SAMPLE_PROMPT,
      enabled: 'false' 
    };
    mockFetch
      .mockImplementationOnce(() => mockResponse([SAMPLE_PROMPT]))
      .mockImplementationOnce(() => mockResponse(toggled));

    const { result } = renderHook(() => useQueryPrompts());

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    await act(async () => {
      await result.current.togglePrompt('p1');
    });

    expect(result.current.prompts[0].enabled).toBe('false');
  });

  it('sets error on create failure', async () => {
    mockFetch
      .mockImplementationOnce(() => mockResponse([SAMPLE_PROMPT]))
      .mockImplementationOnce(() => mockResponse({ error: 'Validation failed' }, 400));

    const { result } = renderHook(() => useQueryPrompts());

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    await act(async () => {
      try {
        await result.current.createPrompt('Bad', 'no keyword placeholder');
      } catch {
        // expected
      }
    });

    expect(result.current.error).toBeTruthy();
  });
});
