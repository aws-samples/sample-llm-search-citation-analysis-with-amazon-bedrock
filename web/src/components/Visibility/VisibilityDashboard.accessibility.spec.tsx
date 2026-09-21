import {
  render, screen
} from '@testing-library/react';
import {
  describe, expect, it, vi
} from 'vitest';
import { VisibilityDashboard } from './VisibilityDashboard';

interface PersonaSelectorMockProps {
  id: string;
  name: string;
}

const hookMocks = vi.hoisted(() => ({
  fetchHistoricalTrends: vi.fn(),
  fetchPersonaRankings: vi.fn(),
  fetchVisibilityMetrics: vi.fn(),
}));
const keywordScopeOptions = vi.hoisted(() => ({
  activeKeywords: [],
  groups: [],
}));

vi.mock('../../hooks/useVisibilityMetrics', () => ({
  useVisibilityMetrics: () => ({
    data: null,
    loading: false,
    error: null,
    fetchVisibilityMetrics: hookMocks.fetchVisibilityMetrics,
  }),
}));
vi.mock('../../hooks/useHistoricalTrends', () => ({
  useHistoricalTrends: () => ({
    data: null,
    loading: false,
    error: null,
    fetchHistoricalTrends: hookMocks.fetchHistoricalTrends,
  }),
}));
vi.mock('../../hooks/usePersonaRankings', () => ({
  usePersonaRankings: () => ({
    data: null,
    loading: false,
    error: null,
    fetchPersonaRankings: hookMocks.fetchPersonaRankings,
  }),
}));
vi.mock('../ui/useKeywordScopeOptions', () => ({ useKeywordScopeOptions: () => keywordScopeOptions }));
vi.mock('../ui/KeywordScopeSelector', () => ({ KeywordScopeSelector: () => <div /> }));
vi.mock('../Personas/PersonaSelector', () => ({ PersonaSelector: (props: PersonaSelectorMockProps) => <select aria-label="Persona selector" id={props.id} name={props.name} /> }));

describe('VisibilityDashboard form accessibility', () => {
  it('supplies a visibility-specific identity to the persona selector', () => {
    render(<VisibilityDashboard keywords={[]} />);

    const personaSelector = screen.getByLabelText<HTMLSelectElement>('Persona selector');

    expect({
      id: personaSelector.id,
      name: personaSelector.name,
    }).toStrictEqual({
      id: 'visibility-persona-filter',
      name: 'visibility-persona-filter',
    });
  });
});
