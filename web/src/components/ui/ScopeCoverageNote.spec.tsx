import {
  describe, expect, it
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { formatDate } from '../../formatting/dateFormatter';
import { scopedFixture } from '../../test/scopedFixtures';
import {
  coverageSentence, ScopeCoverageNote
} from './ScopeCoverageNote';

describe('coverageSentence', () => {
  it('reads "Covers 100 of 928 keywords" when fewer keywords were analyzed', () => {
    expect(coverageSentence(100, 928)).toBe('Covers 100 of 928 keywords');
  });

  it('reads "Covers all 5,000 keywords" when every keyword was analyzed', () => {
    expect(coverageSentence(5000, 5000)).toBe('Covers all 5,000 keywords');
  });

  it('uses the singular for a one-keyword scope', () => {
    expect(coverageSentence(1, 1)).toBe('Covers all 1 keyword');
  });
});

describe('ScopeCoverageNote', () => {
  it('renders nothing for a body from an API build without the coverage fields', () => {
    const { container } = render(<ScopeCoverageNote response={{}} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing before the response loads', () => {
    const { container } = render(<ScopeCoverageNote response={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('says every keyword is covered and when the snapshot was built for a complete snapshot answer', () => {
    const response = scopedFixture('visibility', 'complete');

    render(<ScopeCoverageNote response={response} />);

    expect(screen.getByText(`Covers all 5,000 keywords · figures as of ${formatDate(String(response.as_of))}`)).toBeInTheDocument();
  });

  it('says every keyword is covered without a build time for a complete live answer', () => {
    render(<ScopeCoverageNote response={scopedFixture('visibility', 'live')} />);

    expect(screen.getByText(/^Covers all \d+ keywords$/u)).toBeInTheDocument();
  });

  it('names the analyzed and total keywords and the time budget for a partial live answer', () => {
    const response = scopedFixture('visibility', 'partial');
    const coverage = response.coverage ?? {
      keywords_analyzed: -1,
      keywords_total: -1,
    };

    render(<ScopeCoverageNote response={response} />);

    expect(screen.getByRole('note')).toHaveTextContent(
      `Covers ${coverage.keywords_analyzed} of ${coverage.keywords_total} keywords. The request ran out of time before it read the rest`,
    );
  });

  it('never claims a keyword cap for a partial answer', () => {
    render(<ScopeCoverageNote response={scopedFixture('visibility', 'partial')} />);

    expect(screen.getByRole('note')).not.toHaveTextContent(/first/u);
  });

  it('shows the updating note for a stale snapshot that is being rebuilt', () => {
    render(<ScopeCoverageNote response={scopedFixture('visibility', 'stale')} />);

    expect(screen.getByRole('status')).toHaveTextContent('Updating to the latest keyword changes…');
  });

  it('says the figures predate the change for a stale snapshot with no rebuild running', () => {
    render(<ScopeCoverageNote response={{
      stale: true,
      refreshing: false,
    }} />);

    expect(screen.getByRole('status')).toHaveTextContent('These figures are from before the latest keyword changes');
  });
});
