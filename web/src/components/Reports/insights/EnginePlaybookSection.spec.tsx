import {
  describe, expect, it
} from 'vitest';
import {
  render, within
} from '@testing-library/react';
import { KPI_DEFINITIONS } from '../../../constants/kpiDefinitions';
import { buildEnginePlayRow } from '../../../types/domain/insights-fixtures';
import { sectionTitled } from '../layout/reportQueries-fixtures';
import {
  ENGINE_PLAYBOOK_TITLE, EnginePlaybookSection
} from './EnginePlaybookSection';
import {
  columnTooltip, describeInsightsSectionPlaceholders, expectEmptySection, insightLines, insightsWithFacts, loadedInsights, sectionColumnHeadings,
  sectionRows
} from './insightSections-fixtures';
import { PLAY_INFO } from './insightWording';

function renderPlaybook(slice = loadedInsights()) {
  return render(<EnginePlaybookSection {...slice} />);
}

describe('EnginePlaybookSection', () => {
  it('heads the engine, the shares the play is read from, the citation rate, the sentiment and the play', () => {
    renderPlaybook();

    expect(sectionColumnHeadings(ENGINE_PLAYBOOK_TITLE)).toStrictEqual([
      'AI engine', 'Top-1 share', 'Top-3 share', 'Citation rate', 'Net sentiment', 'Play',
    ]);
  });

  it('explains the KPI columns with their definitions and the play with how it is chosen', () => {
    renderPlaybook();

    expect(columnTooltip('Top-1 share')).toHaveAccessibleDescription(KPI_DEFINITIONS.top_1_share.definition);
    expect(columnTooltip('Citation rate')).toHaveAccessibleDescription(KPI_DEFINITIONS.citation_rate.definition);
    expect(columnTooltip('Play')).toHaveAccessibleDescription(PLAY_INFO);
  });

  it('lists each engine by name with its figures formatted by unit and its play as a chip, in the API order', () => {
    renderPlaybook();

    expect(sectionRows(ENGINE_PLAYBOOK_TITLE)).toStrictEqual([
      ['OpenAI', '40.0%', '70.0%', '80.0%', '+25.0', 'Get ranked first'],
      ['Google Gemini', '60.0%', '85.0%', '20.0%', '-12.5', 'Get cited'],
    ]);
  });

  it.each([
    ['get_mentioned_and_cited', 'Get mentioned and cited'],
    ['defend', 'Defend'],
  ] as const)('labels the %s play "%s"', (play, label) => {
    renderPlaybook(insightsWithFacts({ engines: [buildEnginePlayRow('claude', play)] }));

    expect(sectionRows(ENGINE_PLAYBOOK_TITLE)).toStrictEqual([['Anthropic Claude', '40.0%', '55.0%', '30.0%', '+15.0', label]]);
  });

  it('leaves the citation rate out while no owned domain is configured', () => {
    renderPlaybook(loadedInsights({ citations_configured: false }));

    expect(sectionColumnHeadings(ENGINE_PLAYBOOK_TITLE)).toStrictEqual(['AI engine', 'Top-1 share', 'Top-3 share', 'Net sentiment', 'Play']);
    expect(sectionRows(ENGINE_PLAYBOOK_TITLE)[0]).toStrictEqual(['OpenAI', '40.0%', '70.0%', '+25.0', 'Get ranked first']);
  });

  it('reads out the engine insights above the table, most severe first, and no other insight', () => {
    renderPlaybook();

    expect(insightLines(ENGINE_PLAYBOOK_TITLE)).toStrictEqual([
      'OpenAI: ranked first in 40.0% of answers, links to a tracked domain in 80.0%. Play: get ranked first.',
      'Google Gemini: ranked first in 60.0% of answers, links to a tracked domain in 20.0%. Play: get cited.',
    ]);
  });

  it('shows the table alone when every engine is to be defended', () => {
    renderPlaybook(loadedInsights({ insights: [] }));

    expect(insightLines(ENGINE_PLAYBOOK_TITLE)).toStrictEqual([]);
    expect(within(sectionTitled(ENGINE_PLAYBOOK_TITLE)).getByRole('table')).toBeInTheDocument();
  });

  it('says no engine answered, without a table, when there is none', () => {
    renderPlaybook(insightsWithFacts({ engines: [] }));

    expectEmptySection(ENGINE_PLAYBOOK_TITLE, 'No AI engine answered yet.');
  });

  describeInsightsSectionPlaceholders(EnginePlaybookSection);
});
