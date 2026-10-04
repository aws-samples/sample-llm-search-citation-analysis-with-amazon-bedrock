import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { QueryPromptsManager } from './QueryPromptsManager';
import {
  FAMILY_TRAVELER_PROMPT,
  buildQueryPromptsHookResult,
} from './QueryPromptsManager-generic-fixtures';

vi.mock('../../hooks/useQueryPrompts', () => ({ useQueryPrompts: vi.fn() }));

import { useQueryPrompts } from '../../hooks/useQueryPrompts';

const mockUseQueryPrompts = vi.mocked(useQueryPrompts);

/** Every persona mutation control, with the accessible name of its button. */
const PERSONA_CONTROLS: [control: string, name: RegExp][] = [
  ['create', /New Persona/iu],
  ['per-row edit', /Edit persona/iu],
  ['per-row delete', /Delete persona/iu],
  ['per-row enable toggle', /Disable persona/iu],
];

describe('QueryPromptsManager', () => {
  beforeEach(() => {
    mockUseQueryPrompts.mockReturnValue(
      buildQueryPromptsHookResult([FAMILY_TRAVELER_PROMPT])
    );
  });

  describe('admin users', () => {
    it.each(PERSONA_CONTROLS)('offers the %s control', (_control, name) => {
      render(<QueryPromptsManager isAdmin />);

      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    });
  });

  describe('non-admin users', () => {
    /**
     * POST/PUT/DELETE/PATCH /api/query-prompts are all Admin-only server-side.
     * The list itself stays visible: personas explain the
     * keywords x providers x personas matrix that produced the dashboard data.
     */

    function renderWithoutPersonas() {
      mockUseQueryPrompts.mockReturnValue(buildQueryPromptsHookResult([]));
      render(<QueryPromptsManager isAdmin={false} />);
    }

    it.each(PERSONA_CONTROLS)('hides the %s control', (_control, name) => {
      render(<QueryPromptsManager isAdmin={false} />);

      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    });

    it('still shows the configured personas', () => {
      render(<QueryPromptsManager isAdmin={false} />);

      expect(screen.getByText('Family Traveler')).toBeInTheDocument();
    });

    it('still reports how many personas each run will query', () => {
      render(<QueryPromptsManager isAdmin={false} />);

      expect(screen.getByText(/1 of 1 personas enabled/iu)).toBeInTheDocument();
    });

    it('points at an administrator when no personas exist', () => {
      renderWithoutPersonas();

      expect(screen.getByText(/An administrator can add personas/iu)).toBeInTheDocument();
    });

    it('does not tell non-admin users to create a persona', () => {
      renderWithoutPersonas();

      expect(screen.queryByText(/Create a persona to see how/iu)).not.toBeInTheDocument();
    });
  });
});
