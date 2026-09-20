import { vi } from 'vitest';
import type {
  useAlertSettings as UseAlertSettings,
  useContentChanges as UseContentChanges,
} from '../../hooks/useAlerts';
import type { useKeywordGroups as UseKeywordGroups } from '../../hooks/useKeywordGroups';

export const useAlertSettings = vi.fn<typeof UseAlertSettings>();
export const useContentChanges = vi.fn<typeof UseContentChanges>();
export const useKeywordGroups = vi.fn<typeof UseKeywordGroups>();
