import { createElement } from 'react';
import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { expectRendersNothing } from '../../../../test/renderNothing';
import { OutrankedKeywordsSection } from './OutrankedKeywordsSection';
import { OutreachTargetsSection } from './OutreachTargetsSection';
import { sectionPlaceholderCases } from '../../layout/sectionGate-fixtures';

/** The rollup list sections, which share `gateRollup`. */
const ROLLUP_SECTIONS = [
  ['OutrankedKeywordsSection', OutrankedKeywordsSection],
  ['OutreachTargetsSection', OutreachTargetsSection],
] as const;

const PLACEHOLDER_CASES = ROLLUP_SECTIONS.flatMap(([section, component]) => sectionPlaceholderCases(/Loading/i).map((placeholder) => ({
  section,
  component,
  ...placeholder,
})));

describe('rollup list sections before the rollup arrives', () => {
  it.each(ROLLUP_SECTIONS)('%s returns null when rollup is null', (_name, component) => {
    expectRendersNothing(createElement(component, {
      rollup: null,
      loading: false,
      error: null,
    }));
  });

  it.each(PLACEHOLDER_CASES)('$section renders $name', ({
    component, state, text
  }) => {
    render(createElement(component, {
      rollup: null,
      ...state,
    }));
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});
