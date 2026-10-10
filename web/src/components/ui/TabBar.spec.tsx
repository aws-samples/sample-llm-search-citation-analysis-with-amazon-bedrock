import {
  describe, expect, it
} from 'vitest';
import {
  screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  PANEL_ID, getTabElement, renderTabBar, selectedStates, tabLabels
} from './TabBar-fixtures';

describe('TabBar', () => {
  it('lists every tab, in order, in a tab list named by the label', () => {
    renderTabBar();

    expect(screen.getByRole('tablist', { name: 'Airline' })).toBeInTheDocument();
    expect(tabLabels()).toStrictEqual(['Altiplano Air', 'Condor SurCondor', 'Sky Andes3 new']);
  });

  it('marks only the active tab as selected', () => {
    renderTabBar();

    expect(selectedStates()).toStrictEqual(['true', 'false', 'false']);
  });

  it('keeps a single tab stop, on the selected tab', () => {
    renderTabBar();

    expect(screen.getAllByRole('tab').map((tab) => tab.tabIndex)).toStrictEqual([0, -1, -1]);
  });

  it('selects the tab that is clicked', async () => {
    const onChange = renderTabBar();

    await userEvent.click(getTabElement('Sky Andes3 new'));

    expect(onChange).toHaveBeenCalledWith('sky');
    expect(selectedStates()).toStrictEqual(['false', 'false', 'true']);
  });

  it('draws the icon before the label', () => {
    renderTabBar();

    expect(getTabElement(/Condor Sur/u).firstElementChild?.tagName).toBe('svg');
  });

  it('shows the short label only on narrow screens', () => {
    renderTabBar();
    const tab = getTabElement(/Condor Sur/u);

    expect(within(tab).getByText('Condor Sur')).toHaveClass('hidden', 'sm:inline');
    expect(within(tab).getByText('Condor')).toHaveClass('sm:hidden');
  });

  it('colours the selected tab with its own accent when it has one', async () => {
    renderTabBar();

    await userEvent.click(getTabElement('Sky Andes3 new'));

    expect(getTabElement('Sky Andes3 new')).toHaveClass('text-emerald-600');
    expect(getTabElement('Altiplano Air')).not.toHaveClass('text-emerald-600');
  });

  it.each([
    ['underline', 'border-gray-900'],
    ['pill', 'bg-gray-900'],
  ] as const)('draws the selected %s tab as %s', (variant, selectedClass) => {
    renderTabBar({ variant });

    expect(getTabElement('Altiplano Air')).toHaveClass(selectedClass);
    expect(getTabElement(/Condor Sur/u)).not.toHaveClass(selectedClass);
  });
});

describe('TabBar keyboard', () => {
  it.each([
    ['ArrowRight', 'Altiplano Air', 'condor'],
    ['ArrowLeft', 'Altiplano Air', 'sky'],
    ['End', 'Altiplano Air', 'sky'],
    ['Home', 'Sky Andes3 new', 'altiplano'],
    ['ArrowRight', 'Sky Andes3 new', 'altiplano'],
  ])('%s moves the selection from %s to %s', async (key, from, to) => {
    const onChange = renderTabBar();
    await userEvent.click(getTabElement(from));

    await userEvent.keyboard(`{${key}}`);

    expect(onChange).toHaveBeenLastCalledWith(to);
  });

  it('moves focus along with the selection', async () => {
    renderTabBar();
    await userEvent.tab();

    await userEvent.keyboard('{ArrowRight}');

    expect(getTabElement(/Condor Sur/u)).toHaveFocus();
  });

  it('reaches the selected tab with a single Tab press', async () => {
    renderTabBar();

    await userEvent.tab();

    expect(getTabElement('Altiplano Air')).toHaveFocus();
  });

  it('leaves other keys alone', async () => {
    const onChange = renderTabBar();
    await userEvent.tab();

    await userEvent.keyboard('{ArrowDown}');

    expect(onChange).not.toHaveBeenCalledWith(expect.anything());
  });
});

describe('TabBar panel', () => {
  it('points every tab at the panel it controls', () => {
    renderTabBar({ withPanel: true });

    expect(screen.getAllByRole('tab').map((tab) => tab.getAttribute('aria-controls'))).toStrictEqual([PANEL_ID, PANEL_ID, PANEL_ID]);
  });

  it('names the panel after the selected tab', async () => {
    renderTabBar({ withPanel: true });

    await userEvent.click(getTabElement(/Condor Sur/u));

    expect(screen.getByRole('tabpanel', { name: /Condor Sur/u })).toHaveTextContent('Guide to condor');
  });

  it('claims no panel when the site renders none', () => {
    renderTabBar();

    expect(getTabElement('Altiplano Air')).not.toHaveAttribute('aria-controls');
  });
});
