import {
  describe, it, expect, vi
} from 'vitest';
import {
  screen, within
} from '@testing-library/react';
import { SourcesSections } from './SourcesReport';
import { OWNED_DOMAINS_MISSING } from '../layout/KpiHeadline';
import {
  reportWithVisibility, sectionsRenderer
} from '../scopeReport/scopeReport-fixtures';
import {
  headerTooltips, sectionTable, sectionTitled, statCardInfo, statFigure, statFootnote
} from '../layout/reportQueries-fixtures';
import {
  buildPeriodChange, buildSourceRow
} from '../layout/reportPayload-fixtures';

vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));

const renderSources = sectionsRenderer(SourcesSections);

describe('Sources headline', () => {
  it.each([
    ['Citations', '6'],
    ['Citation rate', '30.0%'],
    ['Citation share', '12.5%'],
  ])('shows your %s', (label, figure) => {
    renderSources();

    expect(statFigure(label).textContent).toBe(figure);
  });

  it.each([
    ['Citations', '+1 vs previous run (3 keywords)'],
    ['Citation rate', '+1.2 pts vs previous run (3 keywords)'],
    ['Citation share', '-2.5 pts vs previous run (3 keywords)'],
  ])('notes the change in %s since each keyword\'s previous run', (label, note) => {
    renderSources(reportWithVisibility({ change: buildPeriodChange() }));

    expect(statFootnote(label)).toBe(note);
  });

  it.each([['Citations'], ['Citation rate'], ['Citation share']])('asks for owned domains before measuring the %s', (label) => {
    renderSources(reportWithVisibility({
      citations_configured: false,
      change: buildPeriodChange(),
    }));

    expect(statFootnote(label)).toBe(OWNED_DOMAINS_MISSING);
  });

  it('counts every domain cited, not only the listed ones', () => {
    renderSources(reportWithVisibility({ sources_total: 42 }));

    expect(statFigure('Domains cited').textContent).toBe('42');
  });

  it('explains the domains cited in the card tooltip', () => {
    renderSources();

    expect(statCardInfo('Domains cited')).toBe('How many distinct domains the answers cite as sources, yours and everyone else\'s.');
  });
});

describe('Sources most cited domains', () => {
  it('states each domain\'s citations, yours marked, in the chart caption', () => {
    renderSources();

    expect(within(sectionTitled('Most cited domains')).getByText(/^Answers citing each/).textContent)
      .toBe('Answers citing each of the 3 most cited domains: runnersworld.com 9, nike.com 6 (yours) and reddit.com 5.');
  });
});

describe('Sources domains table', () => {
  it('heads the domain, its citations, rate, share, engines and keywords', () => {
    renderSources();

    expect(sectionTable('Cited domains')[0]).toStrictEqual(['Domain', 'Citations', 'Citation rate', 'Citation share', 'Engines', 'Keywords']);
  });

  it('explains every per-domain figure in its column tooltip', () => {
    renderSources();

    expect(headerTooltips('Cited domains')).toStrictEqual([
      ['Citations', 'Answers that cite the domain at least once.'],
      ['Citation rate', 'Share of the AI answers that cite the domain as a source.'],
      ['Citation share', 'The domain\'s share of all the sources the answers cite; each domain counts once per answer.'],
      ['Engines', 'The AI engines whose answers cite the domain.'],
      ['Keywords', 'How many keywords have an answer citing the domain.'],
    ]);
  });

  it('shows every figure of a domain', () => {
    renderSources();

    expect(sectionTable('Cited domains')[3]).toStrictEqual(['reddit.com', '5', '25.0%', '25.0%', 'OpenAI', '1']);
  });

  it('lists the domains most cited first', () => {
    renderSources();

    expect(sectionTable('Cited domains').slice(1).map(([domain]) => domain)).toStrictEqual(['runnersworld.com', 'nike.com', 'reddit.com']);
  });

  it('badges only your owned domains', () => {
    renderSources();

    expect(within(sectionTitled('Cited domains')).getByText('Owned').closest('td')?.firstChild?.textContent).toBe('nike.com');
  });

  it('notes when only the most cited domains are listed', () => {
    renderSources(reportWithVisibility({ sources_total: 40 }));

    expect(screen.getByText('Listing the 3 most cited of 40 domains.')).toBeInTheDocument();
  });

  it('puts only the Citation Gaps pointer under the table when every domain is listed', () => {
    renderSources();

    expect([...sectionTitled('Cited domains').querySelectorAll('p')].map((paragraph) => paragraph.textContent)).toStrictEqual([
      'The domains the latest runs cite, most cited first. Your owned domains carry a badge.',
      'Which sources cite your competitors but not you? See the Citation Gaps analysis.',
    ]);
  });

  it('points to the Citation Gaps analysis', () => {
    renderSources();

    expect(screen.getByRole('link', { name: 'See the Citation Gaps analysis' })).toHaveAttribute('href', '/citation-gaps');
  });

  it('says so when no answer cites a source', () => {
    renderSources(reportWithVisibility({
      sources: [],
      sources_total: 0,
    }));

    expect(within(sectionTitled('Cited domains')).getByText('No answer cites a source yet.')).toBeInTheDocument();
  });

  it.each([
    [['gemini', 'openai'], 'Google Gemini, OpenAI'],
    [[], ''],
  ])('writes the engines %j citing a domain as "%s"', (engines, names) => {
    renderSources(reportWithVisibility({ sources: [buildSourceRow('example.org', { engines })] }));

    expect(sectionTable('Cited domains')[1]).toStrictEqual(['example.org', '4', '20.0%', '20.0%', names, '2']);
  });
});
