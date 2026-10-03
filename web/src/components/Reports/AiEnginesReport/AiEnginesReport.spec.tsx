import {
  describe, it, expect, vi
} from 'vitest';
import { within } from '@testing-library/react';
import { EngineSections } from './AiEnginesReport';
import {
  buildEngineKpis, buildEngines, buildPeriodChange
} from '../layout/reportPayload-fixtures';
import {
  sectionTable, sectionTitled, statCardInfo, statFigure, statFootnote
} from '../layout/reportQueries-fixtures';
import {
  reportWithVisibility, sectionsRenderer
} from '../scopeReport/scopeReport-fixtures';

vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));

const renderEngines = sectionsRenderer(EngineSections);

const NO_ENGINE = reportWithVisibility({ engines: [] });

describe('AI Engines headline', () => {
  it('shows your engine coverage', () => {
    renderEngines();

    expect(statFigure('Engine coverage').textContent).toBe('75.0%');
  });

  it('notes the change in engine coverage since each keyword\'s previous run', () => {
    renderEngines(reportWithVisibility({ change: buildPeriodChange() }));

    expect(statFootnote('Engine coverage')).toBe('+0.8 pts vs previous run (3 keywords)');
  });

  it('counts the engines answering', () => {
    renderEngines();

    expect(statFigure('Engines answering').textContent).toBe('2');
  });

  it('counts only the engines whose answers name your brand', () => {
    const engines = [...buildEngines(), buildEngineKpis('perplexity', {
      mentions: 0,
      visibility_score: 0,
    })];
    renderEngines(reportWithVisibility({ engines }));

    expect([statFigure('Engines naming you').textContent, statFootnote('Engines naming you')]).toStrictEqual(['2', 'of 3 answering']);
  });

  it('names the engine with your highest visibility score', () => {
    renderEngines();

    expect([statFigure('Strongest engine').textContent, statFootnote('Strongest engine')]).toStrictEqual(['Google Gemini', 'Visibility score 61.5']);
  });

  it('has no strongest engine before any engine answered', () => {
    renderEngines(NO_ENGINE);

    expect([statFigure('Strongest engine').textContent, statFootnote('Strongest engine')]).toStrictEqual(['—', 'No visibility score yet']);
  });

  it.each([
    ['Engines answering', 'The AI engines with at least one answer in the latest runs.'],
    ['Engines naming you', 'The AI engines with at least one answer that names your brand.'],
    ['Strongest engine', 'The AI engine whose answers give your brand the highest visibility score.'],
  ])('explains %s in the card tooltip', (label, info) => {
    renderEngines();

    expect(statCardInfo(label)).toBe(info);
  });
});

describe('AI Engines KPIs per engine', () => {
  it('states each engine\'s mention rate, visibility score and citation rate in the chart caption', () => {
    renderEngines();

    expect(within(sectionTitled('KPIs per engine')).getByText(/per AI engine/).textContent).toMatch(/Google Gemini: Mention rate 70\.0%, Visibility score 61\.5, Citation rate 40\.0%/);
  });
});

describe('AI Engines table', () => {
  it('lists one row per engine, in the API\'s order', () => {
    renderEngines();

    expect(sectionTable('Every KPI per engine').slice(1).map(([engine]) => engine)).toStrictEqual(['Google Gemini', 'OpenAI']);
  });

  it('shows every KPI of an engine', () => {
    renderEngines();

    expect(sectionTable('Every KPI per engine')[2]).toStrictEqual([
      'OpenAI', '10', '5', '50.0%', '21.7%', '1.80', '40.0%', '55.0%', '43.3', '2', '20.0%', '12.5%', '+15.0', '75.0%', '80.0%',
    ]);
  });

  it('keeps an engine id the dashboard does not know', () => {
    renderEngines(reportWithVisibility({ engines: [buildEngineKpis('mistral')] }));

    expect(sectionTable('Every KPI per engine')[1][0]).toBe('mistral');
  });
});

describe('AI Engines sections before any engine answered', () => {
  it.each([['KPIs per engine'], ['Every KPI per engine']])('says so in the %s section', (title) => {
    renderEngines(NO_ENGINE);

    expect(within(sectionTitled(title)).getByText('No AI engine answered yet.')).toBeInTheDocument();
  });
});

describe('AI Engines sentiment per engine', () => {
  it('states each engine\'s sentiment split in the chart caption', () => {
    renderEngines();

    expect(within(sectionTitled('Sentiment per engine')).getByText(/^Sentiment of the labelled mentions/).textContent).toBe(
      'Sentiment of the labelled mentions per row, stacked to 100%. '
      + 'Google Gemini: 41.7% positive, 33.3% neutral, 16.7% mixed, 8.3% negative of 12 labelled mentions. '
      + 'OpenAI: 41.7% positive, 33.3% neutral, 16.7% mixed, 8.3% negative of 12 labelled mentions.',
    );
  });
});
