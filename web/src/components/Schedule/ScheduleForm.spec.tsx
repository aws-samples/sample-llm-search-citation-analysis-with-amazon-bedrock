import { screen } from '@testing-library/react';
import {
  describe, expect, it
} from 'vitest';
import { renderScheduleForm } from './ScheduleForm-fixtures';
import {
  fieldIdentity, keywordPickerIdentity, labelledFieldIdentity, valuedFieldIdentity
} from '../../test/fieldIdentity';

describe('ScheduleForm', () => {
  it('associates default schedule fields with page-specific identities', () => {
    renderScheduleForm();

    expect(['Schedule name', 'Repeat', 'Time', 'Timezone'].map(labelledFieldIdentity)).toStrictEqual([
      {
        id: 'schedule-display-name',
        labelFor: 'schedule-display-name',
        name: 'schedule-display-name',
      },
      {
        id: 'schedule-frequency',
        labelFor: 'schedule-frequency',
        name: 'schedule-frequency',
      },
      {
        id: 'schedule-time',
        labelFor: 'schedule-time',
        name: 'schedule-time',
      },
      {
        id: 'schedule-timezone',
        labelFor: 'schedule-timezone',
        name: 'schedule-timezone',
      },
    ]);
  });

  it('associates Enabled with its schedule-specific identity', () => {
    renderScheduleForm();

    const enabled = screen.getByRole<HTMLInputElement>('switch', { name: 'Enabled' });

    expect(fieldIdentity(enabled)).toStrictEqual({
      id: 'schedule-enabled',
      labelFor: 'schedule-enabled',
      name: 'schedule-enabled',
    });
  });

  it('gives every scope option exact submission metadata', () => {
    renderScheduleForm();

    // Only the keyword-scope radios: the "What to run" cards are radios too when the SEO stack is configured.
    const radios = screen.getAllByRole<HTMLInputElement>('radio').filter((radio) => radio.name === 'schedule-scope-mode');

    expect(radios.map(valuedFieldIdentity)).toStrictEqual([
      {
        id: 'schedule-scope-mode-all',
        labelFor: 'schedule-scope-mode-all',
        name: 'schedule-scope-mode',
        value: 'all',
      },
      {
        id: 'schedule-scope-mode-groups',
        labelFor: 'schedule-scope-mode-groups',
        name: 'schedule-scope-mode',
        value: 'groups',
      },
      {
        id: 'schedule-scope-mode-keywords',
        labelFor: 'schedule-scope-mode-keywords',
        name: 'schedule-scope-mode',
        value: 'keywords',
      },
    ]);
  });

  it('associates the weekly timing field with its schedule-specific identity', () => {
    renderScheduleForm({ mode: 'all' }, { frequency: 'weekly' });

    expect(labelledFieldIdentity('Day of week')).toStrictEqual({
      id: 'schedule-day-of-week',
      labelFor: 'schedule-day-of-week',
      name: 'schedule-day-of-week',
    });
  });

  it('associates the monthly timing field with its schedule-specific identity', () => {
    renderScheduleForm({ mode: 'all' }, { frequency: 'monthly' });

    expect(labelledFieldIdentity('Day of month')).toStrictEqual({
      id: 'schedule-day-of-month',
      labelFor: 'schedule-day-of-month',
      name: 'schedule-day-of-month',
    });
  });

  it('gives group checkboxes stable plural names and exact values', () => {
    renderScheduleForm({
      mode: 'groups',
      group_ids: [],
    });

    const group = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Include group Hotel Coruña' });

    expect(valuedFieldIdentity(group)).toStrictEqual({
      id: 'schedule-group-group-coruna',
      labelFor: 'schedule-group-group-coruna',
      name: 'schedule-group-ids',
      value: 'group-coruna',
    });
  });

  it('applies schedule identities to the shared keyword picker', () => {
    renderScheduleForm({
      mode: 'keywords',
      keyword_ids: [],
    });

    expect(keywordPickerIdentity('best hotels malaga')).toStrictEqual({
      search: {
        id: 'schedule-keyword-scope-search',
        labelFor: 'schedule-keyword-scope-search',
        name: 'schedule-keyword-scope-search',
      },
      keyword: {
        id: 'schedule-keyword-scope-section-group-coruna-keyword-kw-1',
        labelFor: 'schedule-keyword-scope-section-group-coruna-keyword-kw-1',
        name: 'schedule-keyword-ids',
        value: 'kw-1',
      },
    });
  });
});
