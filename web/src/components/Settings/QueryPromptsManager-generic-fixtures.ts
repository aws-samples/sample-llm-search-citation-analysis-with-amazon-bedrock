import { vi } from 'vitest';
import type { QueryPrompt } from '../../types';
import type { useQueryPrompts } from '../../hooks/useQueryPrompts';

export const FAMILY_TRAVELER_PROMPT = {
  id: 'persona-1',
  name: 'Family Traveler',
  template: 'As a parent, what are the best {keyword}?',
  description: 'Parent of three',
  enabled: 'true',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
} satisfies QueryPrompt;

export const GENERIC_PREVIEW_PROMPT = {
  id: 'persona-generic',
  name: 'Software buyer',
  template: 'Compare {keyword}',
  description: 'Evaluates software options',
  enabled: 'true',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} satisfies QueryPrompt;

export function buildQueryPromptsHookResult(
  prompts: QueryPrompt[] = [GENERIC_PREVIEW_PROMPT]
): ReturnType<typeof useQueryPrompts> {
  return {
    prompts,
    loading: false,
    error: null,
    fetchPrompts: vi.fn(),
    createPrompt: vi.fn(),
    updatePrompt: vi.fn(),
    deletePrompt: vi.fn(),
    togglePrompt: vi.fn(),
  };
}
