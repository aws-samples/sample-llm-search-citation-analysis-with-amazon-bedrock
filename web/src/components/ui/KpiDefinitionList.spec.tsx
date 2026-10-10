import {
  describe, expect, it
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { KpiDefinitionList } from './KpiDefinitionList';

const DEFINITIONS = [
  {
    label: 'Mention rate',
    definition: 'Answers naming Altiplano Air.',
  },
  {
    label: 'Share of voice',
    definition: 'Mentions of Altiplano Air among all brand mentions.',
  },
  {
    label: 'Change and trend',
    definition: 'From 2 points.',
  },
];

describe('KpiDefinitionList', () => {
  it('names every KPI in the order given', () => {
    render(<KpiDefinitionList definitions={DEFINITIONS} />);

    expect(screen.getAllByRole('term').map((term) => term.textContent)).toStrictEqual([
      'Mention rate', 'Share of voice', 'Change and trend',
    ]);
  });

  it('writes each definition out next to its name', () => {
    render(<KpiDefinitionList definitions={DEFINITIONS} />);

    expect(screen.getAllByRole('definition').map((entry) => entry.textContent)).toStrictEqual([
      'Answers naming Altiplano Air.',
      'Mentions of Altiplano Air among all brand mentions.',
      'From 2 points.',
    ]);
  });

  it('pairs each name with its own definition', () => {
    render(<KpiDefinitionList definitions={DEFINITIONS} />);

    expect(screen.getByText('Share of voice').nextElementSibling).toHaveTextContent('Mentions of Altiplano Air among all brand mentions.');
  });

  it('renders an empty list for no definitions', () => {
    render(<KpiDefinitionList definitions={[]} />);

    expect(screen.queryAllByRole('term')).toHaveLength(0);
  });
});
