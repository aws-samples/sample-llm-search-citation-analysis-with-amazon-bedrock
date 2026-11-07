import { screen } from '@testing-library/react';
import {
  beforeEach, describe, expect, it
} from 'vitest';
import {
  createStorageMock, type StorageMock
} from '../../test/storageMock';
import { installStorageMock } from '../../test/installStorageMock';
import {
  SCHEDULES_COUNT, getNavLinkElement, getSidebarElement, getToggleElement, mockStorageDenied, renderSidebar, setupKeyboardToggle,
  setupToggled
} from './Sidebar-fixtures';
import { SIDEBAR_COLLAPSED_STORAGE_KEY } from './useSidebarCollapsed';

const storage: StorageMock = createStorageMock();

beforeEach(() => {
  installStorageMock(storage);
});

describe('Sidebar expanded (nothing stored)', () => {
  it.each([
    ['the collapse button reports the sidebar expanded', () => getToggleElement('Collapse sidebar'), 'aria-expanded', 'true'],
    ['the collapse button names the sidebar it controls', () => getToggleElement('Collapse sidebar'), 'aria-controls', 'app-sidebar'],
    ['the open tab is the current page', () => getNavLinkElement('Citations'), 'aria-current', 'page'],
    ['the sidebar is not collapsed', getSidebarElement, 'data-collapsed', 'false'],
  ] as const)('%s', (_name, element, attribute, value) => {
    renderSidebar();

    expect(element()).toHaveAttribute(attribute, value);
  });

  it('sets no tooltip on the links', () => {
    renderSidebar();

    expect(getNavLinkElement('Citations')).not.toHaveAttribute('title');
  });
});

describe('Sidebar collapsed to the rail', () => {
  it.each([
    ['the button turns into a not-expanded "Expand sidebar"', () => getToggleElement('Expand sidebar'), 'aria-expanded', 'false'],
    ['the sidebar is marked collapsed for the content offset', getSidebarElement, 'data-collapsed', 'true'],
    ['each label becomes its icon tooltip', () => getNavLinkElement('Citations'), 'title', 'Citations'],
    ['a badge count joins the tooltip', () => getNavLinkElement('Schedule'), 'title', `Schedule (${SCHEDULES_COUNT})`],
    ['the links keep their targets', () => getNavLinkElement('Citations'), 'href', '/citations'],
  ] as const)('%s', async (_name, element, attribute, value) => {
    await setupToggled();

    expect(element()).toHaveAttribute(attribute, value);
  });

  it('keeps the count of a badge in the link name for screen readers', async () => {
    await setupToggled();

    expect(getNavLinkElement('Schedule')).toHaveAccessibleName(`Schedule${SCHEDULES_COUNT}`);
  });

  it('hides the section titles on desktop', async () => {
    await setupToggled();

    expect(screen.getByText('Insights').parentElement).toHaveClass('lg:hidden');
  });

  it('expands again on a second click', async () => {
    await setupToggled(2);

    expect(getSidebarElement()).toHaveAttribute('data-collapsed', 'false');
  });

  it.each([['Enter', '{Enter}'], ['Space', ' ']])('collapses from the keyboard with %s', async (_key, keys) => {
    await setupKeyboardToggle(keys);

    expect(getSidebarElement()).toHaveAttribute('data-collapsed', 'true');
  });

  it('keeps the focus on the toggle after a keyboard toggle', async () => {
    await setupKeyboardToggle('{Enter}');

    expect(getToggleElement('Expand sidebar')).toHaveFocus();
  });
});

describe('Sidebar collapse persistence', () => {
  it.each([[1, 'true'], [2, 'false']] as const)('stores the choice after %i click(s) as %s', async (clicks, stored) => {
    await setupToggled(clicks);

    expect(storage.store[SIDEBAR_COLLAPSED_STORAGE_KEY]).toBe(stored);
  });

  it.each([['true', 'true'], ['false', 'false'], ['sideways', 'false']])('opens with stored "%s" as collapsed=%s', (stored, collapsed) => {
    storage.store[SIDEBAR_COLLAPSED_STORAGE_KEY] = stored;
    renderSidebar();

    expect(getSidebarElement()).toHaveAttribute('data-collapsed', collapsed);
  });

  it('opens expanded when the storage cannot be read', () => {
    mockStorageDenied(storage, 'getItem');
    renderSidebar();

    expect(getSidebarElement()).toHaveAttribute('data-collapsed', 'false');
  });

  it('still collapses when the storage cannot be written', async () => {
    mockStorageDenied(storage, 'setItem');
    await setupToggled();

    expect(getSidebarElement()).toHaveAttribute('data-collapsed', 'true');
  });
});
