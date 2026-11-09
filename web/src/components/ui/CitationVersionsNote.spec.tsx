import {
  describe, it, expect
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { citationVersionsOf } from './CitationVersionsNote';
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
  it('names each rule with its answers when a scope mixes them', () => {
    const visibility = {
      coverage: COVERAGE,
      kpis: MIXED,
    };
    render(<ScopeCoverageNote response={visibility} />);

    expect(screen.getByRole('note')).toHaveTextContent(
      'mix two definitions: 30 answers under citation rule 2 and 10 answers unversioned (pre-2.43.0).'
    );
  });

  it('shows nothing for a scope of one rule', () => {
    const visibility = {
      coverage: COVERAGE,
      kpis: CURRENT,
    };
    render(<ScopeCoverageNote response={visibility} />);

    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('flags a trend whose periods each hold one rule but not the same one', () => {
    const older = {
      citation_versions: [{
        version: 'unversioned (pre-2.43.0)',
        answers: 5,
      }],
      citation_versions_mixed: false,
    };

    expect(citationVersionsOf({ trend_data: [{ kpis: older }, { kpis: CURRENT }] })).toStrictEqual([
      {
        version: 'unversioned (pre-2.43.0)',
        answers: 5,
      },
      {
        version: '2',
        answers: 40,
      },
    ]);
  });

  it('reads the scope total and not the periods again when the response has both', () => {
    expect(citationVersionsOf({
      kpis: CURRENT,
      trend_data: [{ kpis: CURRENT }],
    })).toStrictEqual([{
      version: '2',
      answers: 40,
    }]);
  });

  it('shows nothing for an API body from before 2.48.0', () => {
    expect(citationVersionsOf({ kpis: { citation_rate: 20 } })).toStrictEqual([]);
  });
});
