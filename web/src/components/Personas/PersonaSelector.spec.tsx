import {
  render, screen
} from '@testing-library/react';
import {
  describe, expect, it, vi
} from 'vitest';
import { PersonaSelector } from './PersonaSelector';

vi.mock('../../infrastructure', () => ({
  API_BASE_URL: 'https://api.example.test',
  authenticatedFetch: vi.fn().mockResolvedValue({ ok: false }),
}));

describe('PersonaSelector', () => {
  it('associates the persona label with the supplied field identity', () => {
    render(
      <PersonaSelector
        id="test-persona-filter"
        name="test-persona-filter"
        selectedPersonaId={null}
        onPersonaChange={vi.fn()}
      />
    );

    const selector = screen.getByLabelText('Filter by persona');

    expect(selector).toHaveAttribute('id', 'test-persona-filter');
    expect(selector).toHaveAttribute('name', 'test-persona-filter');
    expect(screen.getByText('Filter by persona')).toHaveAttribute('for', 'test-persona-filter');
  });
});
