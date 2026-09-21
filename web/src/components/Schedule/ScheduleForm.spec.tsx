import { screen } from '@testing-library/react';
import {
  describe, expect, it
} from 'vitest';
import { renderScheduleForm } from './ScheduleForm-fixtures';

describe('ScheduleForm', () => {
  it('associates default schedule fields with page-specific identities', () => {
    renderScheduleForm();

    const fields = ['Schedule name', 'Frequency', 'Time', 'Timezone'].map((label) => (
      screen.getByLabelText<HTMLInputElement | HTMLSelectElement>(label)
    ));

    expect(fields.map((field) => [
      field.id,
      field.labels?.[0]?.htmlFor,
      field.name,
    ])).toStrictEqual([
      [
        'schedule-display-name',
        'schedule-display-name',
        'schedule-display-name',
      ],
      [
        'schedule-frequency',
        'schedule-frequency',
        'schedule-frequency',
      ],
      [
        'schedule-time',
        'schedule-time',
        'schedule-time',
      ],
      [
        'schedule-timezone',
        'schedule-timezone',
        'schedule-timezone',
      ],
    ]);
  });

  it('associates Enabled with its schedule-specific identity', () => {
    renderScheduleForm();

    const enabled = screen.getByRole<HTMLInputElement>('checkbox', { name: /Enabled/u });

    expect({
      id: enabled.id,
      labelFor: enabled.labels?.[0]?.htmlFor,
      name: enabled.name,
    }).toStrictEqual({
      id: 'schedule-enabled',
      labelFor: 'schedule-enabled',
      name: 'schedule-enabled',
    });
  });

  it('gives every scope option exact submission metadata', () => {
    renderScheduleForm();

    const radios = screen.getAllByRole<HTMLInputElement>('radio');

    expect(radios.map((radio) => ({
      id: radio.id,
      labelFor: radio.labels?.[0]?.htmlFor,
      name: radio.name,
      value: radio.value,
    }))).toStrictEqual([
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

    const dayOfWeek = screen.getByLabelText<HTMLSelectElement>('Day of week');

    expect({
      id: dayOfWeek.id,
      labelFor: dayOfWeek.labels?.[0]?.htmlFor,
      name: dayOfWeek.name,
    }).toStrictEqual({
      id: 'schedule-day-of-week',
      labelFor: 'schedule-day-of-week',
      name: 'schedule-day-of-week',
    });
  });

  it('associates the monthly timing field with its schedule-specific identity', () => {
    renderScheduleForm({ mode: 'all' }, { frequency: 'monthly' });

    const dayOfMonth = screen.getByLabelText<HTMLInputElement>('Day of month (1-28)');

    expect({
      id: dayOfMonth.id,
      labelFor: dayOfMonth.labels?.[0]?.htmlFor,
      name: dayOfMonth.name,
    }).toStrictEqual({
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

    expect({
      id: group.id,
      labelFor: group.labels?.[0]?.htmlFor,
      name: group.name,
      value: group.value,
    }).toStrictEqual({
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

    const search = screen.getByLabelText<HTMLInputElement>('Search keywords');
    const keyword = screen.getByRole<HTMLInputElement>('checkbox', { name: 'best hotels malaga' });

    expect([
      [
        search.id,
        search.labels?.[0]?.htmlFor,
        search.name,
      ],
      [
        keyword.id,
        keyword.labels?.[0]?.htmlFor,
        keyword.name,
        keyword.value,
      ],
    ]).toStrictEqual([
      [
        'schedule-keyword-scope-search',
        'schedule-keyword-scope-search',
        'schedule-keyword-scope-search',
      ],
      [
        'schedule-keyword-scope-section-group-coruna-keyword-kw-1',
        'schedule-keyword-scope-section-group-coruna-keyword-kw-1',
        'schedule-keyword-ids',
        'kw-1',
      ],
    ]);
  });
});
