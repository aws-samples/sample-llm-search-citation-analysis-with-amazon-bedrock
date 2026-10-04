import {
  describe, expect, it
} from 'vitest';
import { themedAxis } from '../../ui/chartTheme';
import {
  DEFAULT_ENGINE_KPI_IDS, describeEngineKpis, engineKpiSeries
} from './engineKpiChartConfiguration';
import { providerName } from '../../../constants/providers';
import { KPI_COLOURS } from './chartKpis';
import {
  ENGINES, engineKpiChart, LIGHT_THEME, THEME_VARIANTS
} from './charts-fixtures';

describe('buildEngineKpiChartConfiguration', () => {
  it('compares the mention rate, visibility score and citation rate by default', () => {
    expect(DEFAULT_ENGINE_KPI_IDS).toStrictEqual(['mention_rate', 'visibility_score', 'citation_rate']);
  });

  it('groups the bars by engine display name, an unknown engine by its id', () => {
    expect(engineKpiChart().data.labels).toStrictEqual(['Google Gemini', 'OpenAI', 'mistral']);
  });

  it('draws a bar per KPI, labelled with its KPI definition label', () => {
    expect(engineKpiChart().data.datasets.map((dataset) => dataset.label)).toStrictEqual(['Mention rate', 'Visibility score', 'Citation rate']);
  });

  it('plots each KPI per engine, with an unknown value as no bar', () => {
    expect(engineKpiChart().data.datasets.map((dataset) => dataset.data)).toStrictEqual([[70, 50, 10], [61.5, 43.3, 8.5], [40, 20, null]]);
  });

  it.each(THEME_VARIANTS)('fills every KPI bar with its fixed %s colour', (variant, isDark) => {
    expect(engineKpiChart(ENGINES, ['share_of_voice', 'top_1_share'], isDark).data.datasets.map((dataset) => dataset.backgroundColor))
      .toStrictEqual([KPI_COLOURS.share_of_voice[variant], KPI_COLOURS.top_1_share[variant]]);
  });

  it('keeps the engine axis plain', () => {
    expect(engineKpiChart().options?.scales?.x).toStrictEqual(themedAxis(LIGHT_THEME));
  });
});

describe('providerName', () => {
  it.each([
    ['openai', 'OpenAI'],
    ['perplexity', 'Perplexity'],
    ['gemini', 'Google Gemini'],
    ['claude', 'Anthropic Claude'],
    ['mistral', 'mistral'],
    ['constructor', 'constructor'],
  ])('names the engine %s "%s"', (engine, expected) => {
    expect(providerName(engine)).toBe(expected);
  });
});

describe('describeEngineKpis', () => {
  it('summarises each engine\'s KPIs in words', () => {
    expect(describeEngineKpis(engineKpiSeries(ENGINES.slice(1), ['mention_rate', 'citation_rate']))).toBe(
      'Mention rate and Citation rate per AI engine, on a 0–100 scale. '
      + 'OpenAI: Mention rate 50.0%, Citation rate 20.0%. mistral: Mention rate 10.0%, Citation rate —.',
    );
  });

  it('says nothing without an engine', () => {
    expect(describeEngineKpis(engineKpiSeries([], DEFAULT_ENGINE_KPI_IDS))).toBe('');
  });
});
