import {
  describe, expect, it
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { groupScope } from '../../../ui/reportScope-fixtures';
import { sectionTitles } from '../../layout/reportQueries-fixtures';
import { buildReportSources } from '../customReportPages-fixtures';
import { ReportBlockView } from '../ReportBlockView';
import {
  buildInsightsSource, loadingInsightsSource
} from '../reportSources-fixtures';
import type { ReportSources } from '../reportSources';
import { INSIGHT_BLOCKS } from './insightBlocks';

const GROUP_INPUTS: ReportSources['inputs'] = {
  scope: groupScope('hotel-sol'),
  days: 90,
  competitor: null,
};

function renderBlock(type: string, overrides: Partial<ReportSources> = {}) {
  return render(<ReportBlockView block={{ type }} sources={buildReportSources({
    insights: buildInsightsSource(),
    ...overrides,
  })} />);
}

describe('INSIGHT_BLOCKS', () => {
  it('offers every insights block to every scope but the run stability and the narrative, which a group alone shows, all from the insights source', () => {
    expect(INSIGHT_BLOCKS.map((block) => [block.type, block.category, [...block.scopes], [...block.sources]])).toStrictEqual([
      ['insights_summary', 'insights', ['all', 'group', 'keyword'], ['insights']],
      ['insights_engine_playbook', 'insights', ['all', 'group', 'keyword'], ['insights']],
      ['insights_prompt_engine', 'insights', ['all', 'group', 'keyword'], ['insights']],
      ['insights_citation_ownership', 'insights', ['all', 'group', 'keyword'], ['insights']],
      ['insights_owned_pages', 'insights', ['all', 'group', 'keyword'], ['insights']],
      ['insights_competitor_caveats', 'insights', ['all', 'group', 'keyword'], ['insights']],
      ['insights_brand_portfolio', 'insights', ['all', 'group', 'keyword'], ['insights']],
      ['insights_run_stability', 'insights', ['group'], ['insights']],
      ['insights_narrative', 'insights', ['group'], ['insights']],
    ]);
  });

  it.each([
    ['insights_summary', 'Top insights'],
    ['insights_engine_playbook', 'Engine playbook'],
    ['insights_prompt_engine', 'Prompts by engine'],
    ['insights_citation_ownership', 'Who the engines cite'],
    ['insights_owned_pages', 'Your most-cited pages'],
    ['insights_competitor_caveats', 'Competitor caveats'],
    ['insights_brand_portfolio', 'Brand portfolio'],
  ])('renders %s as the %s section of the insights source, labelled Insights', (type, title) => {
    renderBlock(type);

    expect(sectionTitles()).toStrictEqual([title]);
    expect(screen.getByText('Insights')).toBeInTheDocument();
  });

  it('renders the run stability of a keyword group', () => {
    renderBlock('insights_run_stability', { inputs: GROUP_INPUTS });

    expect(sectionTitles()).toStrictEqual(['Run stability']);
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('asks for a keyword group instead of the run stability of every keyword', () => {
    renderBlock('insights_run_stability');

    expect(screen.getByText('Pick a keyword group above to show this block.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the loading placeholder while the insights source loads', () => {
    renderBlock('insights_engine_playbook', { insights: loadingInsightsSource() });

    expect(screen.getByText('Loading insights…')).toBeInTheDocument();
  });

  it('renders nothing while the insights source is not mounted', () => {
    const { container } = render(<>{INSIGHT_BLOCKS[0].render(buildReportSources({ insights: null }))}</>);

    expect(container.firstChild).toBeNull();
  });
});
