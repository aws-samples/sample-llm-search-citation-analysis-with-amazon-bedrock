import {
  describe, expect, it, vi
} from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderGroupKpiReport } from './GroupKpiReport-fixtures';
import {
  headerTooltips, kpiRowTooltips, sectionTable
} from '../layout/reportQueries-fixtures';
import {
  historyWithoutOwnedDomains, RUN_1
} from './groupKpiHistory-fixtures';
import {
  KPI_DEFINITIONS, KPI_SPECS
} from '../../../constants/kpiDefinitions';
import { KPI_TABLE_ROWS } from '../layout/kpiHeadline-fixtures';

vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));

const IMPACT_NOTE = 'Share of the group\'s change: the keyword\'s change weighted by its share of the run\'s answers.';

describe('GroupKpiReport KPI table', () => {
  it('heads the KPI table with the KPI, its value, change and trend', () => {
    renderGroupKpiReport();

    expect(sectionTable('Headline')[0]).toStrictEqual(['KPI', 'Value', 'Change', 'Trend']);
  });

  it('lists every KPI of the selected run in report order with its value, change since the previous group run and trend', () => {
    renderGroupKpiReport();

    expect(sectionTable('Headline').slice(1)).toStrictEqual(KPI_TABLE_ROWS);
  });

  it('explains every KPI of the table in a tooltip holding its definition', () => {
    renderGroupKpiReport();

    expect(kpiRowTooltips()).toStrictEqual(KPI_SPECS.map((spec) => [`About ${spec.label}`, spec.definition]));
  });

  it('shows no change or trend for a run without an earlier group run', async () => {
    renderGroupKpiReport();

    await userEvent.selectOptions(screen.getByLabelText('Run'), RUN_1);

    expect(sectionTable('Headline').slice(1).map((row) => row.slice(2))).toStrictEqual(KPI_SPECS.map(() => ['—', '—']));
  });

  it('shows the unmeasured citation KPIs as dashes before owned domains are set', () => {
    renderGroupKpiReport({ history: historyWithoutOwnedDomains() });

    expect(sectionTable('Headline').slice(9, 12).map((row) => row.slice(0, 2))).toStrictEqual([
      ['Citations', '—'], ['Citation rate', '—'], ['Citation share', '—'],
    ]);
  });
});

describe('GroupKpiReport drivers table', () => {
  it('heads the drivers table with the keyword, its mention, every KPI change and both impacts', () => {
    renderGroupKpiReport();

    expect(sectionTable('What changed')[0]).toStrictEqual([
      'Keyword', 'Brand mention', 'Mention rate', 'Mention rate impact', 'Visibility score', 'Visibility impact',
      'Share of voice', 'Average position', 'Top-1 share', 'Answers',
    ]);
  });

  it('explains every KPI column of the drivers table in a header tooltip', () => {
    renderGroupKpiReport();

    expect(headerTooltips('What changed')).toStrictEqual([
      ['Brand mention', 'Whether the keyword\'s answers started or stopped naming your brand since the previous group run.'],
      ['Mention rate', KPI_DEFINITIONS.mention_rate.definition],
      ['Mention rate impact', IMPACT_NOTE],
      ['Visibility score', KPI_DEFINITIONS.visibility_score.definition],
      ['Visibility impact', IMPACT_NOTE],
      ['Share of voice', KPI_DEFINITIONS.share_of_voice.definition],
      ['Average position', KPI_DEFINITIONS.average_position.definition],
      ['Top-1 share', KPI_DEFINITIONS.top_1_share.definition],
      ['Answers', KPI_DEFINITIONS.answers.definition],
    ]);
  });
});

describe('GroupKpiReport keyword detail table', () => {
  it('heads the keyword detail table with the run, its mention and every KPI', () => {
    renderGroupKpiReport();

    expect(sectionTable('Keyword detail')[0]).toStrictEqual([
      'Run', 'Brand mentioned', 'Answers mentioning', 'Mention rate', 'Share of voice', 'Average position', 'Top-1 share',
      'Visibility score', 'Citation rate', 'Net sentiment',
    ]);
  });

  it('explains every KPI column of the keyword detail table in a header tooltip', () => {
    renderGroupKpiReport();

    expect(headerTooltips('Keyword detail')).toStrictEqual([
      ['Brand mentioned', 'Whether any answer of this run names your brand; "new" and "lost" compare with the keyword\'s previous run.'],
      ['Answers mentioning', KPI_DEFINITIONS.mentions.definition],
      ['Mention rate', KPI_DEFINITIONS.mention_rate.definition],
      ['Share of voice', KPI_DEFINITIONS.share_of_voice.definition],
      ['Average position', KPI_DEFINITIONS.average_position.definition],
      ['Top-1 share', KPI_DEFINITIONS.top_1_share.definition],
      ['Visibility score', KPI_DEFINITIONS.visibility_score.definition],
      ['Citation rate', KPI_DEFINITIONS.citation_rate.definition],
      ['Net sentiment', KPI_DEFINITIONS.net_sentiment.definition],
    ]);
  });

  it('shows the newest keyword run with each value and its change since the keyword\'s previous run', () => {
    renderGroupKpiReport();

    expect(sectionTable('Keyword detail')[1].slice(1)).toStrictEqual([
      'No (lost)', '0 of 4', '0.0% (-50.0 pts)', '0.0% (-25.0 pts)', '—', '0.0% (-25.0 pts)', '0.0 (-47.5 pts)', '25.0% (0.0 pts)', '—',
    ]);
  });

  it('shows the oldest keyword run last, with its values and no change', () => {
    renderGroupKpiReport();

    expect(sectionTable('Keyword detail')[2]).toStrictEqual([
      new Date(RUN_1).toLocaleString(), 'Yes', '2 of 4', '50.0%', '25.0%', '1.50', '25.0%', '47.5', '25.0%', '+50.0',
    ]);
  });
});
