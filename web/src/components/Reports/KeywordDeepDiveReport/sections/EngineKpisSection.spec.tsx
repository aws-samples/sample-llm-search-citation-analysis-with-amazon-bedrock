import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen, within
} from '@testing-library/react';
import { expectRendersNothing } from '../../../../test/renderNothing';
import {
  ENGINE_CHART_SUBTITLE, EngineKpisSection
} from './EngineKpisSection';
import {
  buildEngineKpis, buildVisibility
} from '../../layout/reportPayload-fixtures';
import {
  sectionTable, sectionTitled
} from '../../layout/reportQueries-fixtures';
import { chartCaption } from '../../BrandVisibilityReport/sections/reportChartPanels-fixtures';

vi.mock('chart.js', () => import('../../../Dashboard/chartJs-fixtures'));

const TITLE = 'KPIs per AI engine';

function renderEngines(visibility = buildVisibility()): void {
  render(<EngineKpisSection visibility={visibility} loading={false} error={null} />);
}

describe('EngineKpisSection', () => {
  it('charts the mention rate, visibility score and citation rate of each engine', () => {
    renderEngines();

    expect(chartCaption('AI engines compared', sectionTitled(TITLE))).toBe(
      'Mention rate, Visibility score and Citation rate per AI engine, on a 0–100 scale. '
        + 'Google Gemini: Mention rate 70.0%, Visibility score 61.5, Citation rate 40.0%. '
        + 'OpenAI: Mention rate 50.0%, Visibility score 43.3, Citation rate 20.0%.',
    );
  });

  it('says what the engine chart compares under its title, for print', () => {
    renderEngines();

    expect(within(screen.getByRole('region', { name: 'AI engines compared' })).getByText(ENGINE_CHART_SUBTITLE)).toBeInTheDocument();
  });

  it('writes each engine by name with its KPIs formatted by unit, in the API order', () => {
    renderEngines();

    expect(sectionTable(TITLE).slice(1)).toStrictEqual([
      ['Google Gemini', '10', '7', '70.0%', '28.0%', '1.80', '40.0%', '55.0%', '61.5', '4', '40.0%', '12.5%', '+15.0', '75.0%', '80.0%'],
      ['OpenAI', '10', '5', '50.0%', '21.7%', '1.80', '40.0%', '55.0%', '43.3', '2', '20.0%', '12.5%', '+15.0', '75.0%', '80.0%'],
    ]);
  });

  it('names an engine the dashboard does not know by its id', () => {
    renderEngines(buildVisibility({ engines: [buildEngineKpis('newengine')] }));

    expect(sectionTable(TITLE)[1][0]).toBe('newengine');
  });

  it('says when no engine has answered for the keyword', () => {
    renderEngines(buildVisibility({ engines: [] }));

    expect(screen.getByText('No AI engine has answered for this keyword yet.')).toBeInTheDocument();
  });

  it('drops out of the report without a visibility answer', () => {
    expectRendersNothing(<EngineKpisSection visibility={null} loading={false} error={null} />);
  });
});
