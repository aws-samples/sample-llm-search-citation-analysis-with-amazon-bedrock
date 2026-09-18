import {
  describe, it, expect 
} from 'vitest';
import {
  defaultScheduleFormData,
  describeScheduleScope,
  describeScheduleTiming,
  formDataFromSchedule,
  timezoneOptions,
  toSchedulePayload,
  validateScheduleFormData,
} from './scheduleFormModel';
import {
  GROUP_CORUNA, GROUP_MARINO, buildSchedule, legacyKeywordSchedule 
} from './ScheduleManager-fixtures';

describe('formDataFromSchedule', () => {
  it('copies the stored form, scope and state into the editor', () => {
    expect(formDataFromSchedule(buildSchedule())).toStrictEqual({
      display_name: 'Hotel Coruña — weekly',
      frequency: 'weekly',
      time: '09:00',
      timezone: 'Europe/Madrid',
      day_of_week: 'MON',
      day_of_month: '1',
      enabled: true,
      scope: {
        mode: 'groups',
        group_ids: ['group-coruna'] 
      },
    });
  });

  it('falls back to all keywords for a legacy schedule without a scope', () => {
    expect(formDataFromSchedule(legacyKeywordSchedule).scope).toStrictEqual({ mode: 'all' });
  });

  it('uses the schedule timezone and defaults when the form is missing', () => {
    const formData = formDataFromSchedule(buildSchedule({
      form: null,
      timezone: 'Europe/London' 
    }));

    expect(formData.timezone).toBe('Europe/London');
    expect(formData.frequency).toBe('daily');
    expect(formData.time).toBe('09:00');
  });
});

describe('validateScheduleFormData', () => {
  const valid = {
    ...defaultScheduleFormData(),
    display_name: 'Daily' 
  };

  it('accepts a complete form', () => {
    expect(validateScheduleFormData(valid)).toBeNull();
  });

  it('requires a name', () => {
    expect(validateScheduleFormData({
      ...valid,
      display_name: '   ' 
    })).toBe('Give the schedule a name');
  });

  it('caps the name at 100 characters', () => {
    expect(validateScheduleFormData({
      ...valid,
      display_name: 'x'.repeat(101) 
    })).toBe('The name must be at most 100 characters');
  });

  it('requires a time', () => {
    expect(validateScheduleFormData({
      ...valid,
      time: '' 
    })).toBe('Pick a time (HH:MM)');
  });

  it('refuses a day of month outside 1-28 for monthly schedules', () => {
    expect(validateScheduleFormData({
      ...valid,
      frequency: 'monthly',
      day_of_month: '31' 
    })).toBe('Day of month must be between 1 and 28');
  });

  it('ignores the day of month for non-monthly schedules', () => {
    expect(validateScheduleFormData({
      ...valid,
      frequency: 'weekly',
      day_of_month: '31' 
    })).toBeNull();
  });

  it('requires at least one group for a group scope', () => {
    expect(validateScheduleFormData({
      ...valid,
      scope: {
        mode: 'groups',
        group_ids: [] 
      } 
    })).toBe('Select at least one keyword group');
  });

  it('requires at least one keyword for a keyword scope', () => {
    expect(validateScheduleFormData({
      ...valid,
      scope: {
        mode: 'keywords',
        keyword_ids: [] 
      } 
    })).toBe('Select at least one keyword');
  });
});

describe('toSchedulePayload', () => {
  it('trims text and turns the day of month into a number', () => {
    expect(toSchedulePayload({
      ...defaultScheduleFormData(),
      display_name: '  Coruña  ',
      timezone: ' Europe/Madrid ',
      frequency: 'monthly',
      day_of_month: '15',
    })).toStrictEqual({
      display_name: 'Coruña',
      frequency: 'monthly',
      time: '09:00',
      timezone: 'Europe/Madrid',
      day_of_week: 'MON',
      day_of_month: 15,
      enabled: true,
      scope: { mode: 'all' },
    });
  });
});

describe('describeScheduleTiming', () => {
  it('describes a weekly schedule with its day and zone', () => {
    expect(describeScheduleTiming(buildSchedule())).toBe('Weekly on Monday at 09:00 (Europe/Madrid)');
  });

  it('describes a monthly schedule with its day of month', () => {
    const schedule = buildSchedule({
      form: {
        frequency: 'monthly',
        time: '07:30',
        timezone: 'UTC',
        day_of_week: 'MON',
        day_of_month: 15 
      } 
    });

    expect(describeScheduleTiming(schedule)).toBe('Monthly on day 15 at 07:30 (UTC)');
  });

  it('describes a daily schedule', () => {
    expect(describeScheduleTiming(legacyKeywordSchedule)).toBe('Daily at 07:00 (UTC)');
  });

  it('falls back to the raw expression when the form is unknown', () => {
    expect(describeScheduleTiming(buildSchedule({
      form: null,
      schedule: 'rate(2 hours)',
      timezone: 'UTC' 
    }))).toBe('rate(2 hours) (UTC)');
  });
});

describe('describeScheduleScope', () => {
  const groups = [GROUP_CORUNA, GROUP_MARINO];

  it('names the selected groups', () => {
    expect(describeScheduleScope({
      mode: 'groups',
      group_ids: ['group-marino', 'group-coruna'] 
    }, groups)).toBe('Groups: Hotel Marino, Hotel Coruña');
  });

  it('flags a group that no longer exists', () => {
    expect(describeScheduleScope({
      mode: 'groups',
      group_ids: ['gone'] 
    }, groups)).toBe('Groups: deleted group');
  });

  it('counts selected keywords', () => {
    expect(describeScheduleScope({
      mode: 'keywords',
      keyword_ids: ['a', 'b', 'c'] 
    }, groups)).toBe('3 selected keyword(s)');
  });

  it('says all active keywords for an all scope', () => {
    expect(describeScheduleScope({ mode: 'all' }, groups)).toBe('All active keywords');
  });

  it('lists legacy keyword texts when there is no scope', () => {
    expect(describeScheduleScope(null, groups, ['a', 'b'])).toBe('2 keyword(s) from the previous version: a, b');
  });

  it('asks for an edit when neither scope nor keywords are known', () => {
    expect(describeScheduleScope(null, groups)).toBe('Scope unknown - edit to choose keywords');
  });
});

describe('timezoneOptions', () => {
  it('always includes UTC and the current value, sorted', () => {
    const options = timezoneOptions('Mars/Olympus_Mons');

    expect(options).toContain('UTC');
    expect(options).toContain('Mars/Olympus_Mons');
    expect(options).toStrictEqual([...options].sort((left, right) => left.localeCompare(right)));
  });

  it('offers Europe/Madrid', () => {
    expect(timezoneOptions('UTC')).toContain('Europe/Madrid');
  });
});
