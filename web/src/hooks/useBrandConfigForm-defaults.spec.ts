import {
  describe, expect, it
} from 'vitest';
import {
  act, renderHook
} from '@testing-library/react';
import { useBrandConfigForm } from './useBrandConfigForm';
import {
  EMPTY_INDUSTRY_BRAND_CONFIG,
  GENERAL_AND_CUSTOM_PRESETS,
  HOTEL_PRESETS,
  UNKNOWN_INDUSTRY_CONFIG,
  UNKNOWN_INDUSTRY_OVERRIDE_CONFIG,
} from './useBrandConfigForm-defaults-fixtures';

describe('useBrandConfigForm General defaults', () => {
  it('uses General when stored industry is empty', () => {
    const { result } = renderHook(
      () => useBrandConfigForm(EMPTY_INDUSTRY_BRAND_CONFIG, GENERAL_AND_CUSTOM_PRESETS)
    );

    expect(result.current.form.industry).toBe('general');
  });

  it('preserves an unknown stored industry key', () => {
    const { result } = renderHook(
      () => useBrandConfigForm(UNKNOWN_INDUSTRY_CONFIG, GENERAL_AND_CUSTOM_PRESETS)
    );

    expect(result.current.form.industry).toBe('legacy-industry');
  });

  it('returns Custom preset when stored industry is unknown', () => {
    const { result } = renderHook(
      () => useBrandConfigForm(UNKNOWN_INDUSTRY_CONFIG, GENERAL_AND_CUSTOM_PRESETS)
    );

    expect(result.current.currentPreset).toStrictEqual(GENERAL_AND_CUSTOM_PRESETS.custom);
  });

  it('uses Custom default prompt when stored industry is unknown', () => {
    const { result } = renderHook(
      () => useBrandConfigForm(UNKNOWN_INDUSTRY_CONFIG, GENERAL_AND_CUSTOM_PRESETS)
    );

    expect(result.current.form.currentPrompt).toBe(
      'Extract custom brand and company mentions.'
    );
  });

  it('uses stored override before Custom fallback for unknown industry', () => {
    const { result } = renderHook(
      () => useBrandConfigForm(UNKNOWN_INDUSTRY_OVERRIDE_CONFIG, GENERAL_AND_CUSTOM_PRESETS)
    );

    expect(result.current.form.currentPrompt).toBe('Stored legacy prompt');
  });

  it('returns no preset when unknown industry has no Custom fallback', () => {
    const { result } = renderHook(
      () => useBrandConfigForm(UNKNOWN_INDUSTRY_CONFIG, HOTEL_PRESETS)
    );

    expect(result.current.currentPreset).toBeUndefined();
  });

  it('uses an empty prompt when unknown industry has no Custom fallback', () => {
    const { result } = renderHook(
      () => useBrandConfigForm(UNKNOWN_INDUSTRY_CONFIG, HOTEL_PRESETS)
    );

    expect(result.current.form.currentPrompt).toBe('');
  });

  it('removes only the unknown-industry override when reset to Custom default', () => {
    const { result } = renderHook(
      () => useBrandConfigForm(UNKNOWN_INDUSTRY_OVERRIDE_CONFIG, GENERAL_AND_CUSTOM_PRESETS)
    );

    act(() => {
      result.current.resetPromptToDefault();
    });

    const industryPrompts = result.current.buildConfig().industry_prompts;
    expect(industryPrompts).toStrictEqual({ general: 'Retained general prompt' });
  });
});
