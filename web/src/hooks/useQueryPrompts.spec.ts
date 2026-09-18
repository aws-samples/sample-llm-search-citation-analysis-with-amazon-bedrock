/**
 * Tests for useQueryPrompts hook.
 */
import {
  renderHook, waitFor, act 
} from '@testing-library/react';
import {
  vi, describe, it, expect 
} from 'vitest';
import { useQueryPrompts } from './useQueryPrompts';
import {
  renderLoadedQueryPrompts, respondOnce, samplePrompt 
} from './useQueryPrompts-fixtures';

import { mockAuthenticatedFetch as mockFetch } from '../test/infrastructureMock';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

class TestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestError';
  }
}

describe('useQueryPrompts', () => {
  it('fetches prompts on mount', async () => {
    const { result } = await renderLoadedQueryPrompts();

    expect(mockFetch).toHaveBeenCalledWith('https://api.test.com/query-prompts');
    expect(result.current.prompts).toHaveLength(1);
    expect(result.current.prompts[0].name).toBe('Family Traveler');
  });

  it('returns an empty prompt list when the fetch fails', async () => {
    mockFetch.mockRejectedValue(new TestError('Network error'));

    const { result } = renderHook(() => useQueryPrompts());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.prompts).toHaveLength(0);
  });

  it('creates a prompt and adds to state', async () => {
    const newPrompt = {
      ...samplePrompt,
      id: 'p2',
      name: 'Business' 
    };
    const { result } = await renderLoadedQueryPrompts();
    respondOnce(newPrompt, 201);

    await act(() => result.current.createPrompt('Business', 'As a business traveler, find {keyword}'));

    expect(result.current.prompts).toHaveLength(2);
  });

  it('deletes a prompt and removes from state', async () => {
    const { result } = await renderLoadedQueryPrompts();
    respondOnce({ message: 'deleted' });

    await act(() => result.current.deletePrompt('p1'));

    expect(result.current.prompts).toHaveLength(0);
  });

  it('toggles a prompt and updates state', async () => {
    const { result } = await renderLoadedQueryPrompts();
    respondOnce({
      ...samplePrompt,
      enabled: 'false' 
    });

    await act(() => result.current.togglePrompt('p1'));

    expect(result.current.prompts[0].enabled).toBe('false');
  });

  it('sets error on create failure', async () => {
    const { result } = await renderLoadedQueryPrompts();
    respondOnce({ error: 'Validation failed' }, 400);

    await act(() => expect(result.current.createPrompt('Bad', 'no keyword placeholder')).rejects.toThrow('HTTP 400'));

    expect(result.current.error).toBe('HTTP 400');
  });
});
