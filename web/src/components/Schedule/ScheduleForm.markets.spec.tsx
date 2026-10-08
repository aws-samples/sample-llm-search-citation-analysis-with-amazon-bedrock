import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import {
  describe, expect, it
} from 'vitest';
import type { AnalysisScope } from '../../types';
import { renderScheduleForm } from './ScheduleForm-fixtures';
import { GROUP_CORUNA } from './ScheduleManager-fixtures';
import {
  buildMarketSelectionMock, marketSelectionWrapper
} from '../Markets/markets-fixtures';

const WITH_MARKETS = { wrapper: marketSelectionWrapper(buildMarketSelectionMock()) };

function renderForm(scope: AnalysisScope) {
  return renderScheduleForm(scope, {}, WITH_MARKETS).updateFormField;
}

describe('ScheduleForm markets', () => {
  it.each<[string, AnalysisScope, AnalysisScope]>([
    ['narrows the scope to a ticked market', { mode: 'all' }, {
      mode: 'all',
      market_ids: ['br-pt'],
    }],
    ['removes the narrowing when the last market is unticked', {
      mode: 'all',
      market_ids: ['br-pt'],
    }, { mode: 'all' }],
  ])('%s', async (_description, scope, expected) => {
    const updateFormField = renderForm(scope);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Brazil (Portuguese)' }));

    expect(updateFormField).toHaveBeenCalledWith('scope', expected);
  });

  it('keeps the markets when the scope mode changes', async () => {
    const updateFormField = renderForm({
      mode: 'all',
      market_ids: ['cl-es'],
    });

    await userEvent.click(screen.getByRole('radio', { name: /Keyword groups/u }));

    expect(updateFormField).toHaveBeenCalledWith('scope', {
      mode: 'groups',
      group_ids: [],
      market_ids: ['cl-es'],
    });
  });

  it('keeps the markets when a group is picked', async () => {
    const updateFormField = renderForm({
      mode: 'groups',
      group_ids: [],
      market_ids: ['global'],
    });

    await userEvent.click(screen.getByRole('checkbox', { name: `Include group ${GROUP_CORUNA.name}` }));

    expect(updateFormField).toHaveBeenCalledWith('scope', {
      mode: 'groups',
      group_ids: [GROUP_CORUNA.id],
      market_ids: ['global'],
    });
  });

  it('shows the ticked markets as checked', () => {
    renderForm({
      mode: 'all',
      market_ids: ['cl-es'],
    });

    expect(screen.getByRole('checkbox', { name: 'Chile (Spanish)' })).toBeChecked();
  });
});
