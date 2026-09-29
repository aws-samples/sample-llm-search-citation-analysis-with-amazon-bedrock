import {
  describe, it, expect, vi
} from 'vitest';
import { within } from '@testing-library/react';
import { EngineSections } from './AiEnginesReport';
import {
  buildEngineKpis, buildEngines, buildPeriodChange
} from '../layout/reportPayload-fixtures';
import {
  headerTooltips, sectionTable, sectionTitled, statCardInfo, statFigure, statFootnote
} from '../layout/reportQueries-fixtures';
import {
  buildScopeReport, renderSections, reportWithVisibility
} from '../scopeReport/scopeReport-fixtures';
import { KPI_SPECS } from '../../../constants/kpiDefinitions';

vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));

describe('AI Engines headline', () => {
  it('shows your engine coverage', () => {
    renderSections(<EngineSections report={buildScopeReport()} />);

    expect(statFigure('Engine coverage').textContent).toBe('75.0%');
  });

  it('notes the change in engine coverage since each keyword\'s previous run', () => {
    renderSections(<EngineSections report={reportWithVisibility({ change: buildPeriodChange() })} />);

    expect(statFootnote('Engine coverage')).toBe('+0.8 pts vs previous run (3 keywords)');
  });

  it('counts the engines answering', () => {
    renderSections(<EngineSections report={buildScopeReport()} />);

    expect(statFigure('Engines answering').textContent).toBe('2');
  });

  it('counts only the engines whose answers name your brand', () => {
    const engines = [...buildEngines(), buildEngineKpis('perplexity', {
      mentions: 0,
      visibility_score: 0,
    })];
    renderSections(<EngineSections report={reportWithVisibility({ engines })} />);

    expect([statFigure('Engines naming you').textContent, statFootnote('Engines naming you')]).toStrictEqual(['2', 'of 3 answering']);
  });

  it('names the engine with your highest visibility score', () => {
    renderSections(<EngineSections report={buildScopeReport()} />);

    expect([statFigure('Strongest engine').textContent, statFootnote('Strongest engine')]).toStrictEqual(['Google Gemini', 'Visibility score 61.5']);
  });

  it('has no strongest engine before any engine answered', () => {
    renderSections(<EngineSections report={reportWithVisibility({ engines: [] })} />);

    expect([statFigure('Strongest engine').textContent, statFootnote('Strongest engine')]).toStrictEqual(['—', 'No visibility score yet']);
  });

  it.each([
    ['Engines answering', 'The AI engines with at least one answer in the latest runs.'],
    ['Engines naming you', 'The AI engines with at least one answer that names your brand.'],
    ['Strongest engine', 'The AI engine whose answers give your brand the highest visibility score.'],
  ])('explains %s in the card tooltip', (label, info) => {
    renderSections(<EngineSections report={buildScopeReport()} />);

    expect(statCardInfo(label)).toBe(info);
  });
});

describe('AI Engines KPIs per engine', () => {
  it('states each engine\'s mention rate, visibility score and citation rate in the chart caption', () => {
    renderSections(<EngineSections report={buildScopeReport()} />);

    expect(within(sectionTitled('KPIs per engine')).getByText(/per AI engine/).textContent).toMatch(/Google Gemini: Mention rate 70\.0%, Visibility score 61\.5, Citation rate 40\.0%/);
  });

  it('says so in the chart when no engine answered', () => {
    renderSections(<EngineSections report={reportWithVisibility({ engines: [] })} />);

    expect(within(sectionTitled('KPIs per engine')).getByText('No AI engine answered yet.')).toBeInTheDocument();
  });
});

describe('AI Engines table', () => {
  it('heads a column for every KPI after the engine', () => {
    renderSections(<EngineSections report={buildScopeReport()} />);

    expect(sectionTable('Every KPI per engine')[0]).toStrictEqual(['AI engine', ...KPI_SPECS.map((spec) => spec.label)]);
  });

  it('explains every KPI column with its definition', () => {
    renderSections(<EngineSections report={buildScopeReport()} />);

    expect(headerTooltips('Every KPI per engine')).toStrictEqual(KPI_SPECS.map((spec) => [spec.label, spec.definition]));
  });

  it('lists one row per engine, in the API\'s order', () => {
    renderSections(<EngineSections report={buildScopeReport()} />);

    expect(sectionTable('Every KPI per engine').slice(1).map(([engine]) => engine)).toStrictEqual(['Google Gemini', 'OpenAI']);
  });

  it('shows every KPI of an engine', () => {
    renderSections(<EngineSections report={buildScopeReport()} />);

    expect(sectionTable('Every KPI per engine')[2]).toStrictEqual([
      'OpenAI', '10', '5', '50.0%', '21.7%', '1.80', '40.0%', '55.0%', '43.3', '2', '20.0%', '12.5%', '+15.0', '75.0%', '80.0%',
    ]);
  });

  it('keeps an engine id the dashboard does not know', () => {
    renderSections(<EngineSections report={reportWithVisibility({ engines: [buildEngineKpis('mistral')] })} />);

    expect(sectionTable('Every KPI per engine')[1][0]).toBe('mistral');
  });

  it('says so when no engine answered', () => {
    renderSections(<EngineSections report={reportWithVisibility({ engines: [] })} />);

    expect(within(sectionTitled('Every KPI per engine')).getByText('No AI engine answered yet.')).toBeInTheDocument();
  });
});

describe('AI Engines sentiment per engine', () => {
  it('states each engine\'s sentiment split in the chart caption', () => {
    renderSections(<EngineSections report={buildScopeReport()} />);

    expect(within(sectionTitled('Sentiment per engine')).getByText(/^Sentiment of the labelled mentions/).textContent).toBe(
      'Sentiment of the labelled mentions per row, stacked to 100%. '
      + 'Google Gemini: 41.7% positive, 33.3% neutral, 16.7% mixed, 8.3% negative of 12 labelled mentions. '
      + 'OpenAI: 41.7% positive, 33.3% neutral, 16.7% mixed, 8.3% negative of 12 labelled mentions.',
    );
  });
});
