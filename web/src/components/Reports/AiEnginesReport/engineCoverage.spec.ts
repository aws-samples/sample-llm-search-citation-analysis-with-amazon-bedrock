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

  it('picks the engine with the highest visibility score as the strongest', () => {
    expect(engineCoverage(buildEngines()).strongest?.engine).toBe('gemini');
  });

  it('keeps the first engine as the strongest on a tied score', () => {
    const engines = [buildEngineKpis('gemini'), buildEngineKpis('openai')];

    expect(engineCoverage(engines).strongest?.engine).toBe('gemini');
  });

  it('picks a later engine as the strongest when its score is higher', () => {
    const engines = [buildEngineKpis('openai', { visibility_score: 3 }), buildEngineKpis('gemini', { visibility_score: 5 })];

    expect(engineCoverage(engines).strongest?.engine).toBe('gemini');
  });

  it('picks an engine scoring 0 as the strongest when no other engine is scored', () => {
    expect(engineCoverage([buildEngineKpis('gemini', { visibility_score: 0 })]).strongest?.engine).toBe('gemini');
  });

  it('skips engines without a visibility score', () => {
    const engines = [buildEngineKpis('gemini', { visibility_score: null }), buildEngineKpis('openai', { visibility_score: 3 })];

    expect(engineCoverage(engines).strongest?.engine).toBe('openai');
  });

  it('has no strongest engine without a score', () => {
    expect(engineCoverage([buildEngineKpis('gemini', { visibility_score: null })]).strongest).toBeNull();
  });
});
