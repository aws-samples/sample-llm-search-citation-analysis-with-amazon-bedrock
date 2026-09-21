import {
  createElement, type ComponentProps
} from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import type {
  AnalysisScope, ScheduleFormData
} from '../../types';
import { ScheduleForm } from './ScheduleForm';
import {
  GROUP_CORUNA, GROUP_MARINO, mockKeywords
} from './ScheduleManager-fixtures';

export function buildScheduleFormData(
  overrides: Partial<ScheduleFormData> = {}
): ScheduleFormData {
  return {
    display_name: '',
    frequency: 'daily',
    time: '09:00',
    timezone: 'UTC',
    day_of_week: 'MON',
    day_of_month: '1',
    enabled: true,
    scope: { mode: 'all' },
    ...overrides,
  };
}

export function buildScheduleFormProps(
  formDataOverrides: Partial<ScheduleFormData> = {}
): ComponentProps<typeof ScheduleForm> {
  return {
    mode: 'create',
    formData: buildScheduleFormData(formDataOverrides),
    updateFormField: vi.fn(),
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    saving: false,
    keywords: mockKeywords,
    groups: [GROUP_CORUNA, GROUP_MARINO],
  };
}

export function renderScheduleForm(
  scope: AnalysisScope = { mode: 'all' },
  formDataOverrides: Partial<ScheduleFormData> = {}
): ComponentProps<typeof ScheduleForm> {
  const props = buildScheduleFormProps({
    ...formDataOverrides,
    scope,
  });
  render(createElement(ScheduleForm, props));
  return props;
}
