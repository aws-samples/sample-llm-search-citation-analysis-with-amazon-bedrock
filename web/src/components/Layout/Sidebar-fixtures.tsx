/**
 * The sidebar with inert callbacks under a router, its elements, and storage
 * that refuses access, for `Sidebar.spec.tsx`.
 */
import type { TabType } from '../../types';
import { MemoryRouter } from 'react-router-dom';
import {
  vi, type Mock
} from 'vitest';
import userEvent from '@testing-library/user-event';
import {
  render, screen, within
} from '@testing-library/react';
import type { StorageMock } from '../../test/storageMock';
import { Sidebar } from './Sidebar';

/** Thrown by a storage that refuses access (private mode, a blocked origin). */
class StorageDenied extends Error {
  constructor() {
    super('The storage is not available');
    this.name = 'StorageDenied';
  }
}

export const SCHEDULES_COUNT = 3;

export const KEYWORDS_COUNT = 12;

/** The sidebar on `activeTab` at `path` (the Citations tab by default) with three schedules and twelve keywords. */
export function renderSidebar(activeTab: TabType = 'citations', path = '/citations', keywordsCount = KEYWORDS_COUNT): {readonly onNavigate: Mock<(path: string) => void>;} {
  const onNavigate = vi.fn<(path: string) => void>();
  render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar activeTab={activeTab} onTabChange={vi.fn()} onNavigate={onNavigate} keywordsCount={keywordsCount}
        schedulesCount={SCHEDULES_COUNT} isRunning={false} isOpen={false} onToggle={vi.fn()} />
    </MemoryRouter>,
  );
  return { onNavigate };
}

/** The pages listed under a group's entry, by their `data-nav-child` id. */
export function getGroupChildIds(group: 'SEO' | 'Settings'): (string | undefined)[] {
  const list = document.getElementById(screen.getByRole('button', { name: `Hide ${group} pages` }).getAttribute('aria-controls') ?? '');
  return [...(list?.querySelectorAll('a') ?? [])].map((link) => link.dataset.navChild);
}

export function getSidebarElement(): HTMLElement {
  return screen.getByRole('complementary');
}

/** The collapse / expand button, by its current name. */
export function getToggleElement(name: 'Collapse sidebar' | 'Expand sidebar'): HTMLElement {
  return screen.getByRole('button', { name });
}

/** A navigation link by the start of its accessible name. */
export function getNavLinkElement(label: string): HTMLElement {
  return screen.getByRole('link', { name: new RegExp(`^${label}`) });
}

/** Renders the sidebar and clicks its collapse / expand button once, or twice (collapse, then expand). */
export async function setupToggled(clicks: 1 | 2 = 1) {
  const user = userEvent.setup();
  renderSidebar();
  const toggle = () => user.click(screen.getByRole('button', { name: /^(Collapse|Expand) sidebar$/ }));
  await toggle();
  if (clicks === 2) await toggle();
  return user;
}

/** Renders the sidebar, focuses the collapse button and presses `key`. */
export async function setupKeyboardToggle(key: string) {
  const user = userEvent.setup();
  renderSidebar();
  getToggleElement('Collapse sidebar').focus();
  await user.keyboard(key);
}

/** Makes `method` of the storage throw, as a storage that refuses access does. */
export function mockStorageDenied(storage: StorageMock, method: 'getItem' | 'setItem'): void {
  storage[method].mockImplementation(() => {
    throw new StorageDenied();
  });
}

/** The attention dot inside the link whose name starts with `label`; `null` when it has none. */
export function queryAttentionElement(label: string): HTMLElement | null {
  return within(screen.getByRole('link', { name: new RegExp(`^${label}`) })).queryByRole('status', { name: 'Needs configuration' });
}

/** The rail pop-out of the SEO group; `null` while it is closed. */
export function queryFlyoutElement(): HTMLElement | null {
  return screen.queryByRole('navigation', { name: 'SEO pages' });
}

/** Renders the sidebar on the Citations tab and clicks the SEO entry (on the rail it opens the pop-out). */
export async function setupSeoEntryClicked() {
  const user = userEvent.setup();
  const rendered = renderSidebar();
  await user.click(screen.getByRole('link', { name: 'SEO' }));
  return {
    user,
    ...rendered,
  };
}

/** Renders the sidebar on the SEO overview (its group open) and clicks the control named `name`. */
export async function setupSeoGroupClick(role: 'link' | 'button', name: string) {
  const rendered = renderSidebar('seo', '/seo');
  await userEvent.click(screen.getByRole(role, { name }));
  return rendered;
}
