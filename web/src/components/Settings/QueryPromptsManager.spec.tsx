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

describe('QueryPromptsManager', () => {
  beforeEach(() => {
    mockUseQueryPrompts.mockReturnValue(
      buildQueryPromptsHookResult([FAMILY_TRAVELER_PROMPT])
    );
  });

  describe('admin users', () => {
    it('offers the create control', () => {
      render(<QueryPromptsManager isAdmin />);

      expect(screen.getByRole('button', { name: /New Persona/iu })).toBeInTheDocument();
    });

    it('offers the per-row edit and delete controls', () => {
      render(<QueryPromptsManager isAdmin />);

      expect(screen.getByRole('button', { name: /Edit persona/iu })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Delete persona/iu })).toBeInTheDocument();
    });

    it('offers the per-row enable toggle', () => {
      render(<QueryPromptsManager isAdmin />);

      expect(screen.getByRole('button', { name: /Disable persona/iu })).toBeInTheDocument();
    });
  });

  describe('non-admin users', () => {
    /**
     * POST/PUT/DELETE/PATCH /api/query-prompts are all Admin-only server-side.
     * The list itself stays visible: personas explain the
     * keywords x providers x personas matrix that produced the dashboard data.
     */

    it('hides the create control', () => {
      render(<QueryPromptsManager isAdmin={false} />);

      expect(screen.queryByRole('button', { name: /New Persona/iu })).not.toBeInTheDocument();
    });

    it('hides the per-row edit and delete controls', () => {
      render(<QueryPromptsManager isAdmin={false} />);

      expect(screen.queryByRole('button', { name: /Edit persona/iu })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Delete persona/iu })).not.toBeInTheDocument();
    });

    it('hides the per-row enable toggle', () => {
      render(<QueryPromptsManager isAdmin={false} />);

      expect(screen.queryByRole('button', { name: /Disable persona/iu })).not.toBeInTheDocument();
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
      mockUseQueryPrompts.mockReturnValue(buildQueryPromptsHookResult([]));

      render(<QueryPromptsManager isAdmin={false} />);

      expect(screen.getByText(/An administrator can add personas/iu)).toBeInTheDocument();
    });

    it('does not tell non-admin users to create a persona', () => {
      mockUseQueryPrompts.mockReturnValue(buildQueryPromptsHookResult([]));

      render(<QueryPromptsManager isAdmin={false} />);

      expect(screen.queryByText(/Create a persona to see how/iu)).not.toBeInTheDocument();
    });
  });
});
