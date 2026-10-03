import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { act } from '@testing-library/react';
import { useResearchTemplates } from './useResearchTemplates';
import {
  buildCafeTemplate, buildSavedTemplate, buildTemplate
} from '../components/KeywordResearch/agent/agent-fixtures';
import {
  createEndpointMockFetch, createMockJsonResponse
} from '../test/fetchResponses';
import { renderLoadedHook } from '../test/loadedHook';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

const SAVED = buildSavedTemplate();
const BEACH_RESORTS = buildSavedTemplate({
  id: 't2',
  name: 'Beach resorts',
});
const BEACH_RESORTS_DRAFT = {
  name: 'Beach resorts',
  systemPrompt: 'You research beach resorts for families.',
};

interface TemplatesHookResult { current: ReturnType<typeof useResearchTemplates> }

/** Renders the hook and waits for the initial template list to arrive. */
async function renderLoadedTemplates(): Promise<TemplatesHookResult> {
  const { result } = await renderLoadedHook(() => useResearchTemplates());
  return result;
}

/** Renders the loaded hook and saves the Beach resorts template from `draft`. */
async function renderAfterCreatingBeachResorts(
  draft: Parameters<TemplatesHookResult['current']['create']>[0] = BEACH_RESORTS_DRAFT
) {
  const result = await renderLoadedTemplates();
  mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse(BEACH_RESORTS, 201));
  const outcome = await act(() => result.current.create(draft));
  return {
    result,
    outcome,
  };
}

describe('useResearchTemplates', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch({ items: [buildTemplate(), buildCafeTemplate(), SAVED] }));
  });

  it('keeps the built-ins first in the order the API lists them', async () => {
    const result = await renderLoadedTemplates();

    expect(result.current.templates.map((template) => template.id)).toStrictEqual(['builtin-default', 'builtin-cafes', 't1']);
  });

  it('adds a saved template among the saved ones sorted by name', async () => {
    const {
      result, outcome
    } = await renderAfterCreatingBeachResorts({
      ...BEACH_RESORTS_DRAFT,
      baseTemplateId: 'builtin-default',
    });

    expect(outcome.success).toBe(true);
    expect(result.current.templates.map((template) => template.name)).toStrictEqual(['Hotels', 'Cafés', 'Beach resorts', 'Urban hotels']);
  });

  it('replaces the edited template in place', async () => {
    const result = await renderLoadedTemplates();
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({
      ...SAVED,
      system_prompt: 'Updated prompt text for urban hotels.',
    }));

    await act(() => result.current.update('t1', { systemPrompt: 'Updated prompt text for urban hotels.' }));

    expect(result.current.templates.find((template) => template.id === 't1')?.system_prompt).toBe('Updated prompt text for urban hotels.');
  });

  it('re-sorts the saved templates when one is renamed', async () => {
    const { result } = await renderAfterCreatingBeachResorts();
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({
      ...SAVED,
      name: 'Airport hotels',
    }));

    await act(() => result.current.update('t1', { name: 'Airport hotels' }));

    expect(result.current.templates.map((template) => template.name)).toStrictEqual(['Hotels', 'Cafés', 'Airport hotels', 'Beach resorts']);
  });

  it('removes a deleted template from the list', async () => {
    const result = await renderLoadedTemplates();
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({ message: 'deleted' }));

    const outcome = await act(() => result.current.remove('t1'));

    expect(outcome).toStrictEqual({
      success: true,
      message: 'Template deleted',
    });
    expect(result.current.templates.map((template) => template.id)).toStrictEqual(['builtin-default', 'builtin-cafes']);
  });

  it('asks the API to delete a built-in template instead of refusing it locally', async () => {
    const result = await renderLoadedTemplates();
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({ error: 'Built-in templates cannot be deleted' }, 400));

    await act(() => result.current.remove('builtin-default'));

    expect(mockAuthenticatedFetch).toHaveBeenLastCalledWith(
      'https://api.test.com/keyword-research/templates/builtin-default',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('shows the research server error and logs "[research] Error loading templates:" when the list fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch({}, { shouldFail: true }));

    const result = await renderLoadedTemplates();

    expect(result.current.error).toBe('Keyword research failed');
    expect(consoleError).toHaveBeenCalledWith('[research] Error loading templates:', expect.objectContaining({ statusCode: 500 }));
  });

  it('reports a rejected save without touching the list', async () => {
    const result = await renderLoadedTemplates();
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({ error: 'system_prompt too short (min 20 characters)' }, 400));

    const outcome = await act(() => result.current.create({
      name: 'x',
      systemPrompt: 'short',
    }));

    expect(outcome.success).toBe(false);
    expect(outcome.message).toBe('system_prompt too short (min 20 characters)');
    expect(result.current.templates).toHaveLength(3);
  });
});
