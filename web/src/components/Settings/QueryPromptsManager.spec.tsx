import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { QueryPromptsManager } from './QueryPromptsManager';
import type { QueryPrompt } from '../../types';

vi.mock('../../hooks/useQueryPrompts', () => ({useQueryPrompts: vi.fn(),}));

import { useQueryPrompts } from '../../hooks/useQueryPrompts';

const mockUseQueryPrompts = useQueryPrompts as ReturnType<typeof vi.fn>;

const mockPrompt: QueryPrompt = {
  id: 'persona-1',
  name: 'Family Traveler',
  template: 'As a parent, what are the best {keyword}?',
  description: 'Parent of three',
  enabled: 'true',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

function mockPrompts(prompts: QueryPrompt[]) {
  mockUseQueryPrompts.mockReturnValue({
    prompts,
    loading: false,
    error: null,
    createPrompt: vi.fn(),
    updatePrompt: vi.fn(),
    deletePrompt: vi.fn(),
    togglePrompt: vi.fn(),
  });
}

describe('QueryPromptsManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrompts([mockPrompt]);
  });

  describe('admin users', () => {
    it('offers the create control', () => {
      render(<QueryPromptsManager isAdmin />);

      expect(screen.getByRole('button', { name: /New Persona/i })).toBeInTheDocument();
    });

    it('offers the per-row edit and delete controls', () => {
      render(<QueryPromptsManager isAdmin />);

      expect(screen.getByRole('button', { name: /Edit persona/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Delete persona/i })).toBeInTheDocument();
    });

    it('offers the per-row enable toggle', () => {
      render(<QueryPromptsManager isAdmin />);

      expect(screen.getByRole('button', { name: /Disable persona/i })).toBeInTheDocument();
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

      expect(screen.queryByRole('button', { name: /New Persona/i })).not.toBeInTheDocument();
    });

    it('hides the per-row edit and delete controls', () => {
      render(<QueryPromptsManager isAdmin={false} />);

      expect(screen.queryByRole('button', { name: /Edit persona/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Delete persona/i })).not.toBeInTheDocument();
    });

    it('hides the per-row enable toggle', () => {
      render(<QueryPromptsManager isAdmin={false} />);

      expect(screen.queryByRole('button', { name: /Disable persona/i })).not.toBeInTheDocument();
    });

    it('still shows the configured personas', () => {
      render(<QueryPromptsManager isAdmin={false} />);

      expect(screen.getByText('Family Traveler')).toBeInTheDocument();
    });

    it('still reports how many personas each run will query', () => {
      render(<QueryPromptsManager isAdmin={false} />);

      expect(screen.getByText(/1 of 1 personas enabled/i)).toBeInTheDocument();
    });

    it('points at an administrator when no personas exist', () => {
      /** The admin copy says "Create a persona", which they cannot do. */
      mockPrompts([]);

      render(<QueryPromptsManager isAdmin={false} />);

      expect(screen.getByText(/An administrator can add personas/i)).toBeInTheDocument();
    });

    it('does not tell non-admin users to create a persona', () => {
      mockPrompts([]);

      render(<QueryPromptsManager isAdmin={false} />);

      expect(screen.queryByText(/Create a persona to see how/i)).not.toBeInTheDocument();
    });
  });
});
