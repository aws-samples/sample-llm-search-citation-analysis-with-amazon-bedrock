import {
  describe, it, expect, vi
} from 'vitest';
import {
  render, screen, within
} from '@testing-library/react';
import {
  BrandShareOfVoicePanel, ENGINES_INFO, ENGINES_TITLE, EnginesPanel, SOURCES_INFO, SOURCES_TITLE, SourcesPanel
} from './VisibilityChartPanels';
import { DOMAIN_COLUMN_INFO } from './TopDomainsTable';
import {
  GROUP_ENGINES_CAPTION, GROUP_SHARE_OF_VOICE_CAPTION, GROUP_SOURCES_CAPTION, buildGroupEngines, buildGroupSources, buildVisibility
} from './visibilityOverview-fixtures';
import {
  bodyRowCells, columnHeadingTexts, panelTable, panelTitled
} from './visibilityTables-fixtures';
import { buildSourceRow } from '../Reports/layout/reportPayload-fixtures';
import { KPI_DEFINITIONS } from '../../constants/kpiDefinitions';

vi.mock('chart.js', () => import('../Dashboard/chartJs-fixtures'));

const SHARE_OF_VOICE = 'Share of voice';

describe('BrandShareOfVoicePanel', () => {
  it('charts each brand\'s share of all brand mentions', () => {
    render(<BrandShareOfVoicePanel brands={buildVisibility().brands} />);

    expect(within(panelTitled(SHARE_OF_VOICE)).getByRole('figure')).toHaveTextContent(GROUP_SHARE_OF_VOICE_CAPTION);
  });

  it('explains the share of voice with its KPI definition', () => {
    render(<BrandShareOfVoicePanel brands={buildVisibility().brands} />);

    expect(screen.getByRole('button', { name: `About ${SHARE_OF_VOICE}` })).toHaveAccessibleDescription(KPI_DEFINITIONS.share_of_voice.definition);
  });

  it('says no brand has a share of voice when no answer names one', () => {
    render(<BrandShareOfVoicePanel brands={[]} />);

    expect(within(panelTitled(SHARE_OF_VOICE)).getByText('No brand has a share of voice yet.')).toBeInTheDocument();
  });
});

describe('EnginesPanel', () => {
  it('charts the mention rate, visibility score and citation rate of each engine', () => {
    render(<EnginesPanel engines={buildGroupEngines()} />);

    expect(within(panelTitled(ENGINES_TITLE)).getByRole('figure')).toHaveTextContent(GROUP_ENGINES_CAPTION);
  });

  it('explains what the chart and the table show in the tooltip', () => {
    render(<EnginesPanel engines={buildGroupEngines()} />);

    expect(screen.getByRole('button', { name: `About ${ENGINES_TITLE}` })).toHaveAccessibleDescription(ENGINES_INFO);
  });

  it('lists each engine by name with its KPIs formatted by unit, in the API order', () => {
    render(<EnginesPanel engines={buildGroupEngines()} />);

    expect(bodyRowCells(panelTable(ENGINES_TITLE))).toStrictEqual([
      ['OpenAI', '10', '7', '70.0%', '25.0%', '1.80', '40.0%', '55.0%', '58.0', '6', '40.0%', '12.5%', '+15.0', '75.0%', '80.0%'],
      ['Perplexity', '10', '5', '50.0%', '25.0%', '1.80', '40.0%', '55.0%', '46.8', '6', '20.0%', '12.5%', '+15.0', '75.0%', '80.0%'],
    ]);
  });

  it('says no engine answered, without a table, when there is none', () => {
    render(<EnginesPanel engines={[]} />);

    expect(within(panelTitled(ENGINES_TITLE)).getByText('No AI engine answered yet.')).toBeInTheDocument();
    expect(within(panelTitled(ENGINES_TITLE)).queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('SourcesPanel', () => {
  it('charts the answers citing each of the most cited domains', () => {
    render(<SourcesPanel sources={buildGroupSources()} total={3} />);

    expect(within(panelTitled(SOURCES_TITLE)).getByRole('figure')).toHaveTextContent(GROUP_SOURCES_CAPTION);
  });

  it('explains the domain chart in the tooltip', () => {
    render(<SourcesPanel sources={buildGroupSources()} total={3} />);

    expect(screen.getByRole('button', { name: `About ${SOURCES_TITLE}` })).toHaveAccessibleDescription(SOURCES_INFO);
  });

  it('heads the domain, citations, citation rate, citation share, engines and keywords columns', () => {
    render(<SourcesPanel sources={buildGroupSources()} total={3} />);

    expect(columnHeadingTexts(panelTable(SOURCES_TITLE))).toStrictEqual([
      'Domain', 'Citations', 'Citation rate', 'Citation share', 'Engines', 'Keywords',
    ]);
  });

  it.each([
    ['Citations', DOMAIN_COLUMN_INFO.citations],
    ['Citation rate', DOMAIN_COLUMN_INFO.citationRate],
    ['Citation share', DOMAIN_COLUMN_INFO.citationShare],
    ['Engines', DOMAIN_COLUMN_INFO.engines],
    ['Keywords', DOMAIN_COLUMN_INFO.keywords],
  ])('explains the %s column heading in its tooltip', (heading, explanation) => {
    render(<SourcesPanel sources={buildGroupSources()} total={3} />);

    expect(screen.getByRole('button', { name: `About ${heading}` })).toHaveAccessibleDescription(explanation);
  });

  it('lists every domain most cited first, with its figures and the engines by name', () => {
    render(<SourcesPanel sources={buildGroupSources()} total={3} />);

    expect(bodyRowCells(panelTable(SOURCES_TITLE))).toStrictEqual([
      ['booking.com', '8', '40.0%', '47.1%', 'Google Gemini, OpenAI', '2'],
      ['hotelsol.comowned', '6', '30.0%', '35.3%', 'OpenAI, Perplexity', '2'],
      ['tripadvisor.com', '3', '15.0%', '17.6%', 'Perplexity', '1'],
    ]);
  });

  it.each([
    ['badges and tints', 'hotelsol.com', 'bg-emerald-50'],
    ['leaves untinted', 'booking.com', ''],
  ])('%s the row of %s by whether the brand owns it', (_label, domain, rowClass) => {
    render(<SourcesPanel sources={buildGroupSources()} total={3} />);

    expect(within(panelTable(SOURCES_TITLE)).getByText(domain).closest('tr')?.className).toBe(rowClass);
  });

  it('shows unknown citation rates and shares as dashes', () => {
    render(<SourcesPanel sources={[buildSourceRow('blog.example', {
      citation_rate: null,
      citation_share: null,
    })]} total={1} />);

    expect(bodyRowCells(panelTable(SOURCES_TITLE))[0].slice(2, 4)).toStrictEqual(['—', '—']);
  });

  it.each([
    ['3 of 12 cited domains, most cited first.', buildGroupSources(), 12],
    ['1 of 1 cited domain, most cited first.', [buildSourceRow('booking.com')], 1],
  ])('says "%s" under the table, counting every cited domain', (note, sources, total) => {
    render(<SourcesPanel sources={sources} total={total} />);

    expect(within(panelTitled(SOURCES_TITLE)).getByText(note)).toBeInTheDocument();
  });

  it('says no domain is cited, without a table, when the answers cite none', () => {
    render(<SourcesPanel sources={[]} total={0} />);

    expect(within(panelTitled(SOURCES_TITLE)).getByText('No cited domain yet.')).toBeInTheDocument();
    expect(within(panelTitled(SOURCES_TITLE)).queryByRole('table')).not.toBeInTheDocument();
  });
});
