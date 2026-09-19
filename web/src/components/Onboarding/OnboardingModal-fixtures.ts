import { vi } from 'vitest';
import type { ComponentProps } from 'react';
import { createStorageMock } from '../../test/storageMock';
import type { OnboardingModal } from './OnboardingModal';

export const localStorageMock = createStorageMock();

export function buildProps(
  overrides: Partial<ComponentProps<typeof OnboardingModal>> = {}
): ComponentProps<typeof OnboardingModal> {
  return {
    keywordsCount: 0,
    hasRunAnalysis: false,
    setActiveTab: vi.fn(),
    onNavigateToSettings: vi.fn(),
    ...overrides,
  };
}

export function buildStatus(overrides: Partial<{
  providersConfigured: boolean;
  brandConfigured: boolean;
  scheduleConfigured: boolean;
  personasConfigured: boolean;
}> = {}) {
  return {
    providersConfigured: false,
    brandConfigured: false,
    scheduleConfigured: false,
    personasConfigured: false,
    ...overrides,
  };
}
