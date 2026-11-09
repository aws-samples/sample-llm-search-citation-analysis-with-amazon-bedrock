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

/** Renders the form and opens "Limit to markets", which starts collapsed. */
async function renderForm(scope: AnalysisScope) {
  const { updateFormField } = renderScheduleForm(scope, {}, WITH_MARKETS);
  await userEvent.click(screen.getByRole('button', { name: /^Limit to markets/u }));
  return updateFormField;
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
    const updateFormField = await renderForm(scope);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Brazil (Portuguese)' }));

    expect(updateFormField).toHaveBeenCalledWith('scope', expected);
  });

  it('keeps the markets when the scope mode changes', async () => {
    const updateFormField = await renderForm({
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
    const updateFormField = await renderForm({
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

  it('shows the ticked markets as checked, and counts them while collapsed', async () => {
    await renderForm({
      mode: 'all',
      market_ids: ['cl-es'],
    });

    expect(screen.getByRole('checkbox', { name: 'Chile (Spanish)' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Limit to markets (1 selected)' })).toBeInTheDocument();
  });
});
