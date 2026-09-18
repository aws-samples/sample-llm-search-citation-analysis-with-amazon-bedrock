import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  act, renderHook, waitFor
} from '@testing-library/react';
import { useResearchTemplates } from './useResearchTemplates';
import { buildTemplate } from '../components/KeywordResearch/agent/agent-fixtures';

vi.mock('../infrastructure', async () => {
  const actual: Record<string, unknown> = await vi.importActual('../infrastructure');
  return {
    ...actual,
    API_BASE_URL: 'https://api.test.com',
    authenticatedFetch: vi.fn(),
  };
});

import { authenticatedFetch } from '../infrastructure';

const mockAuthenticatedFetch = vi.mocked(authenticatedFetch);

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: () => Promise.resolve(body),
  } satisfies Partial<Response> as Response;
}

const SAVED = buildTemplate({
  id: 't1',
  name: 'Urban hotels',
  builtin: false,
  system_prompt: 'You research urban hotels for business travellers.',
});

describe('useResearchTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticatedFetch.mockResolvedValue(jsonResponse(200, { items: [SAVED, buildTemplate()] }));
  });

  it('loads templates with the built-in one first', async () => {
    const { result } = renderHook(() => useResearchTemplates());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.templates.map((template) => template.id)).toStrictEqual(['builtin-default', 't1']);
  });

  it('adds a saved template to the list sorted by name', async () => {
    const { result } = renderHook(() => useResearchTemplates());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    mockAuthenticatedFetch.mockResolvedValueOnce(jsonResponse(201, buildTemplate({
      id: 't2',
      name: 'Beach resorts',
      builtin: false,
    })));

    const outcome = await act(() => result.current.create({
      name: 'Beach resorts',
      systemPrompt: 'You research beach resorts for families.',
    }));

    expect(outcome.success).toBe(true);
    expect(result.current.templates.map((template) => template.name)).toStrictEqual(['Hotel keyword research (default)', 'Beach resorts', 'Urban hotels']);
  });

  it('replaces the edited template in place', async () => {
    const { result } = renderHook(() => useResearchTemplates());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    mockAuthenticatedFetch.mockResolvedValueOnce(jsonResponse(200, {
      ...SAVED,
      system_prompt: 'Updated prompt text for urban hotels.',
    }));

    await act(() => result.current.update('t1', { systemPrompt: 'Updated prompt text for urban hotels.' }));

    expect(result.current.templates.find((template) => template.id === 't1')?.system_prompt).toBe('Updated prompt text for urban hotels.');
  });

  it('removes a deleted template from the list', async () => {
    const { result } = renderHook(() => useResearchTemplates());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    mockAuthenticatedFetch.mockResolvedValueOnce(jsonResponse(200, { message: 'deleted' }));

    const outcome = await act(() => result.current.remove('t1'));

    expect(outcome).toStrictEqual({
      success: true,
      message: 'Template deleted',
    });
    expect(result.current.templates.map((template) => template.id)).toStrictEqual(['builtin-default']);
  });

  it('reports a rejected save without touching the list', async () => {
    const { result } = renderHook(() => useResearchTemplates());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    mockAuthenticatedFetch.mockResolvedValueOnce(jsonResponse(400, { error: 'system_prompt too short (min 20 characters)' }));

    const outcome = await act(() => result.current.create({
      name: 'x',
      systemPrompt: 'short',
    }));

    expect(outcome.success).toBe(false);
    expect(outcome.message).toBe('system_prompt too short (min 20 characters)');
    expect(result.current.templates).toHaveLength(2);
  });
});
