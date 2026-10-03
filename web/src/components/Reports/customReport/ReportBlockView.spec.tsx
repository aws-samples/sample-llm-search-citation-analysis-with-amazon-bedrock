import {
  describe, expect, it, vi
} from 'vitest';
import { screen } from '@testing-library/react';
import {
  buildScopeReport, renderSections
} from '../scopeReport/scopeReport-fixtures';
import { buildTextBlock } from './customReport-fixtures';
import {
  buildCompetitorSource, buildReportSources
} from './customReportPages-fixtures';
import { ReportBlockView } from './ReportBlockView';

vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));

const GROUP_INPUTS = {
  scope: {
    kind: 'group',
    groupId: 'hotel-sol',
  },
  days: 90,
  competitor: null,
} as const;

describe('ReportBlockView', () => {
  it('renders a content block as written', () => {
    renderSections(<ReportBlockView block={buildTextBlock({ markdown: 'Mentions rose **after** the launch.' })} sources={buildReportSources()} />);

    expect(screen.getByText('after').tagName).toBe('STRONG');
  });

  it('labels a report section with its report', () => {
    renderSections(<ReportBlockView block={{ type: 'sources_headline' }} sources={buildReportSources({ scope: buildScopeReport() })} />);

    expect(screen.getByText('Sources')).toBeInTheDocument();
  });

  it('leaves the KPI definitions unlabelled', () => {
    renderSections(<ReportBlockView block={{ type: 'kpi_definitions' }} sources={buildReportSources()} />);

    expect(screen.queryByText('Reference')).not.toBeInTheDocument();
  });

  it('notes that a block always covering every keyword ignores a narrower scope', () => {
    const sources = buildReportSources({
      inputs: GROUP_INPUTS,
      competitor: buildCompetitorSource(),
    });
    renderSections(<ReportBlockView block={{ type: 'competitor_headline' }} sources={sources} />);

    expect(screen.getByText('Competitor Gap · covers every keyword')).toBeInTheDocument();
  });

  it('asks for competitors when none is configured', () => {
    renderSections(<ReportBlockView block={{ type: 'competitor_headline' }} sources={buildReportSources({ competitor: buildCompetitorSource() })} />);

    expect(screen.getByText('No competitors configured. Add competitors in Settings › Brand Tracking to show this block.')).toBeInTheDocument();
  });

  it('waits for the tracked competitors before deciding there are none', () => {
    const competitor = buildCompetitorSource({ ready: false });
    renderSections(<ReportBlockView block={{ type: 'competitor_headline' }} sources={buildReportSources({ competitor })} />);

    expect(screen.getByText('Loading the tracked competitors…')).toBeInTheDocument();
  });

  it('asks for a keyword group where a group block cannot show every keyword', () => {
    renderSections(<ReportBlockView block={{ type: 'group_headline' }} sources={buildReportSources()} />);

    expect(screen.getByText('Pick a keyword group above to show this block.')).toBeInTheDocument();
  });

  it('renders nothing for a block type the catalogue no longer offers', () => {
    const { container } = renderSections(<ReportBlockView block={{ type: 'retired_block' }} sources={buildReportSources()} />);

    expect(container).toBeEmptyDOMElement();
  });
});
