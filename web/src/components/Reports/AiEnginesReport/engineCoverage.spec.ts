import {
  describe, it, expect
} from 'vitest';
import { engineCoverage } from './engineCoverage';
import {
  buildEngineKpis, buildEngines
} from '../layout/reportPayload-fixtures';

describe('engineCoverage', () => {
  it('counts every engine answering', () => {
    expect(engineCoverage(buildEngines()).answering).toBe(2);
  });

  it('counts an engine naming your brand once it has a mention', () => {
    const engines = [buildEngineKpis('openai', { mentions: 1 }), buildEngineKpis('gemini', { mentions: 0 }), buildEngineKpis('claude', { mentions: null })];

    expect(engineCoverage(engines).naming).toBe(1);
  });

  it.each([
    {
      name: 'picks the engine with the highest visibility score as the strongest',
      engines: buildEngines(),
      strongest: 'gemini',
    },
    {
      name: 'keeps the first engine as the strongest on a tied score',
      engines: [buildEngineKpis('gemini'), buildEngineKpis('openai')],
      strongest: 'gemini',
    },
    {
      name: 'picks a later engine as the strongest when its score is higher',
      engines: [buildEngineKpis('openai', { visibility_score: 3 }), buildEngineKpis('gemini', { visibility_score: 5 })],
      strongest: 'gemini',
    },
    {
      name: 'picks an engine scoring 0 as the strongest when no other engine is scored',
      engines: [buildEngineKpis('gemini', { visibility_score: 0 })],
      strongest: 'gemini',
    },
    {
      name: 'skips engines without a visibility score',
      engines: [buildEngineKpis('gemini', { visibility_score: null }), buildEngineKpis('openai', { visibility_score: 3 })],
      strongest: 'openai',
    },
  ])('$name', ({
    engines, strongest,
  }) => {
    expect(engineCoverage(engines).strongest?.engine).toBe(strongest);
  });

  it('has no strongest engine without a score', () => {
    expect(engineCoverage([buildEngineKpis('gemini', { visibility_score: null })]).strongest).toBeNull();
  });
});
