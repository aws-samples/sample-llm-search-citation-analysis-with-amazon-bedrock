import {
  describe, expect, it
} from 'vitest';
import { render } from '@testing-library/react';
import { KpiDefinitionsSection } from './KpiDefinitionsSection';
import {
  definitionTerms, definitionTexts, sectionTitles
} from './reportQueries-fixtures';

const DEFINITIONS = [
  {
    label: 'Mention rate',
    definition: 'Answers naming the brand.',
  },
  {
    label: 'Change and trend',
    definition: 'From 2 points.',
  },
];

describe('KpiDefinitionsSection', () => {
  it('heads the block as how the KPIs are measured', () => {
    render(<KpiDefinitionsSection definitions={DEFINITIONS} />);

    expect(sectionTitles()).toStrictEqual(['How these KPIs are measured']);
  });

  it('names every definition in the order given', () => {
    render(<KpiDefinitionsSection definitions={DEFINITIONS} />);

    expect(definitionTerms()).toStrictEqual(['Mention rate', 'Change and trend']);
  });

  it('writes out every definition next to its name', () => {
    render(<KpiDefinitionsSection definitions={DEFINITIONS} />);

    expect(definitionTexts()).toStrictEqual(['Answers naming the brand.', 'From 2 points.']);
  });
});
