import type {
  Keyword, KeywordGroup, Schedule 
} from '../../types';

export const GROUP_CORUNA: KeywordGroup = {
  id: 'group-coruna',
  name: 'Hotel Coruña',
  description: '',
  keyword_count: 2,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

export const GROUP_MARINO: KeywordGroup = {
  id: 'group-marino',
  name: 'Hotel Marino',
  description: '',
  keyword_count: 1,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

export const mockKeywords: Keyword[] = [
  {
    id: 'kw-1',
    keyword: 'best hotels malaga',
    created_at: '2024-01-01T00:00:00Z',
    group_ids: ['group-coruna'],
  },
  {
    id: 'kw-2',
    keyword: 'boutique hotels madrid',
    created_at: '2024-01-02T00:00:00Z',
    group_ids: ['group-marino'],
  },
];

/** A v2 schedule as `GET /api/schedules` returns it. */
export function buildSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 'sch-1a2b3c4d',
    name: 'sch-1a2b3c4d',
    display_name: 'Hotel Coruña — weekly',
    state: 'ENABLED',
    enabled: true,
    schedule: 'cron(0 9 ? * MON *)',
    timezone: 'Europe/Madrid',
    form: {
      frequency: 'weekly',
      time: '09:00',
      timezone: 'Europe/Madrid',
      day_of_week: 'MON',
      day_of_month: 1,
    },
    scope: {
      mode: 'groups',
      group_ids: ['group-coruna'] 
    },
    scope_summary: '1 group(s)',
    keywords: [],
    legacy: false,
    created_at: '2026-09-18T10:00:00Z',
    updated_at: '2026-09-18T10:00:00Z',
    ...overrides,
  };
}

/** A schedule created before 2.3.0 that listed its keywords by text. */
export const legacyKeywordSchedule: Schedule = buildSchedule({
  id: 'priority-daily',
  name: 'priority-daily',
  display_name: 'priority-daily',
  schedule: 'cron(0 7 * * ? *)',
  timezone: 'UTC',
  form: {
    frequency: 'daily',
    time: '07:00',
    timezone: 'UTC',
    day_of_week: 'MON',
    day_of_month: 1,
  },
  scope: null,
  scope_summary: '2 keyword(s)',
  keywords: ['best hotels malaga', 'boutique hotels madrid'],
  legacy: true,
});
