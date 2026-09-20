import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  fireEvent, render, screen
} from '@testing-library/react';
import { buildQueryPromptsHookResult } from './QueryPromptsManager-generic-fixtures';

beforeEach(() => {
  vi.resetModules();
});

describe('QueryPromptsManager generic preview', () => {
  it('previews a query with the generic project-management sample', async () => {
    const useQueryPrompts = vi.fn(() => buildQueryPromptsHookResult());
    vi.doMock('../../hooks/useQueryPrompts', () => ({ useQueryPrompts }));
    const { QueryPromptsManager } = await import('./QueryPromptsManager');
    render(<QueryPromptsManager isAdmin />);

    fireEvent.click(screen.getByRole('button', { name: /New Persona/iu }));
    fireEvent.change(screen.getByLabelText('Query Template'), { target: { value: 'Compare {keyword}' } });

    expect(screen.getByText('Compare best project management software')).toBeInTheDocument();
  });
});
