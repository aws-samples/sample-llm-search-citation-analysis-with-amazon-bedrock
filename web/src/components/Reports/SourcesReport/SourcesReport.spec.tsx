import {
  describe, it, expect, vi
} from 'vitest';
import {
  screen, within
} from '@testing-library/react';
import { SourcesSections } from './SourcesReport';
import { OWNED_DOMAINS_MISSING } from '../layout/KpiHeadline';
import {
  buildScopeReport, renderSections, reportWithVisibility
} from '../scopeReport/scopeReport-fixtures';
import {
  headerTooltips, sectionTable, sectionTitled, statFigure, statFootnote
} from '../layout/reportQueries-fixtures';
import {
  buildPeriodChange, buildSourceRow
} from '../layout/reportPayload-fixtures';
import {
  DOMAIN_CITATIONS_INFO, DOMAIN_RATE_INFO, DOMAIN_SHARE_INFO
} from './sections/DomainsTableSection';

vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));

describe('Sources headline', () => {
  it.each([
    ['Citations', '6'],
    ['Citation rate', '30.0%'],
    ['Citation share', '12.5%'],
  ])('shows your %s', (label, figure) => {
    renderSections(<SourcesSections report={buildScopeReport()} />);

    expect(statFigure(label).textContent).toBe(figure);
  });

  it.each([
    ['Citations', '+1 vs previous run (3 keywords)'],
    ['Citation rate', '+1.2 pts vs previous run (3 keywords)'],
    ['Citation share', '-2.5 pts vs previous run (3 keywords)'],
  ])('notes the change in %s since each keyword\'s previous run', (label, note) => {
    renderSections(<SourcesSections report={reportWithVisibility({ change: buildPeriodChange() })} />);

    expect(statFootnote(label)).toBe(note);
  });

  it.each([['Citations'], ['Citation rate'], ['Citation share']])('asks for owned domains before measuring the %s', (label) => {
    renderSections(<SourcesSections report={reportWithVisibility({
      citations_configured: false,
      change: buildPeriodChange(),
    })} />);

    expect(statFootnote(label)).toBe(OWNED_DOMAINS_MISSING);
  });

  it('counts every domain cited, not only the listed ones', () => {
    renderSections(<SourcesSections report={reportWithVisibility({ sources_total: 42 })} />);

    expect(statFigure('Domains cited').textContent).toBe('42');
  });
});

describe('Sources most cited domains', () => {
  it('states each domain\'s citations, yours marked, in the chart caption', () => {
    renderSections(<SourcesSections report={buildScopeReport()} />);

    expect(within(sectionTitled('Most cited domains')).getByText(/^Answers citing each/).textContent)
      .toBe('Answers citing each of the 3 most cited domains: runnersworld.com 9, nike.com 6 (yours) and reddit.com 5.');
  });
});

describe('Sources domains table', () => {
  it('heads the domain, its citations, rate, share, engines and keywords', () => {
    renderSections(<SourcesSections report={buildScopeReport()} />);

    expect(sectionTable('Cited domains')[0]).toStrictEqual(['Domain', 'Citations', 'Citation rate', 'Citation share', 'Engines', 'Keywords']);
  });

  it('explains the per-domain citation figures', () => {
    renderSections(<SourcesSections report={buildScopeReport()} />);

    expect(headerTooltips('Cited domains').slice(0, 3)).toStrictEqual([
      ['Citations', DOMAIN_CITATIONS_INFO],
      ['Citation rate', DOMAIN_RATE_INFO],
      ['Citation share', DOMAIN_SHARE_INFO],
    ]);
  });

  it('shows every figure of a domain', () => {
    renderSections(<SourcesSections report={buildScopeReport()} />);

    expect(sectionTable('Cited domains')[3]).toStrictEqual(['reddit.com', '5', '25.0%', '25.0%', 'OpenAI', '1']);
  });

  it('lists the domains most cited first', () => {
    renderSections(<SourcesSections report={buildScopeReport()} />);

    expect(sectionTable('Cited domains').slice(1).map(([domain]) => domain)).toStrictEqual(['runnersworld.com', 'nike.com', 'reddit.com']);
  });

  it('badges only your owned domains', () => {
    renderSections(<SourcesSections report={buildScopeReport()} />);

    expect(within(sectionTitled('Cited domains')).getByText('Owned').closest('td')?.firstChild?.textContent).toBe('nike.com');
  });

  it('notes when only the most cited domains are listed', () => {
    renderSections(<SourcesSections report={reportWithVisibility({ sources_total: 40 })} />);

    expect(screen.getByText('Listing the 3 most cited of 40 domains.')).toBeInTheDocument();
  });

  it('adds no listing note when every domain is listed', () => {
    renderSections(<SourcesSections report={buildScopeReport()} />);

    expect(screen.queryByText(/^Listing the/)).not.toBeInTheDocument();
  });

  it('points to the Citation Gaps analysis', () => {
    renderSections(<SourcesSections report={buildScopeReport()} />);

    expect(screen.getByRole('link', { name: 'See the Citation Gaps analysis' })).toHaveAttribute('href', '/citation-gaps');
  });

  it('says so when no answer cites a source', () => {
    renderSections(<SourcesSections report={reportWithVisibility({
      sources: [],
      sources_total: 0,
    })} />);

    expect(within(sectionTitled('Cited domains')).getByText('No answer cites a source yet.')).toBeInTheDocument();
  });

  it('keeps a domain cited by no known engine readable', () => {
    renderSections(<SourcesSections report={reportWithVisibility({ sources: [buildSourceRow('example.org', { engines: [] })] })} />);

    expect(sectionTable('Cited domains')[1]).toStrictEqual(['example.org', '4', '20.0%', '20.0%', '', '2']);
  });
});
