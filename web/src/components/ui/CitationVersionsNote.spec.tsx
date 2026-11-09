import {
  describe, it, expect
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { citationVersionFieldsOf } from './CitationVersionsNote';
import { ScopeCoverageNote } from './ScopeCoverageNote';

const COVERAGE = {
  keywords_total: 12,
  keywords_analyzed: 12,
  complete: true,
};
const MIXED = {
  citation_versions: [{
    version: '2',
    answers: 30,
  }, {
    version: 'unversioned (pre-2.43.0)',
    answers: 10,
  }],
  citation_versions_mixed: true,
};
const CURRENT = {
  citation_versions: [{
    version: '2',
    answers: 40,
  }],
  citation_versions_mixed: false,
};

describe('citation versions note', () => {
  it('names each rule with its answers when the server flags a mix', () => {
    const visibility = {
      coverage: COVERAGE,
      kpis: MIXED,
    };
    render(<ScopeCoverageNote response={visibility} />);

    expect(screen.getByRole('note')).toHaveTextContent(
      'mix two definitions: 30 answers under citation rule 2 and 10 answers unversioned (pre-2.43.0).'
    );
  });

  it('shows nothing when the server says the figures hold one rule', () => {
    const visibility = {
      coverage: COVERAGE,
      kpis: CURRENT,
    };
    render(<ScopeCoverageNote response={visibility} />);

    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('reads a trend window mix the server gives at the top, even when each period holds one rule', () => {
    const trend = {
      ...MIXED,
      trend_data: [{ kpis: CURRENT }],
    };

    expect(citationVersionFieldsOf(trend)).toBe(trend);
  });

  it('shows nothing for an API body from before 2.52.0', () => {
    expect(citationVersionFieldsOf({ kpis: { citation_rate: 20 } })).toBeUndefined();
  });
});
