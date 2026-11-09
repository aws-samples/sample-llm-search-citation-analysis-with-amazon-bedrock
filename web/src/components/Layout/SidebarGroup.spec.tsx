import {
  act, screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { mockAdminRole } from '../../test/useIsAdminMock';
import { createStorageMock } from '../../test/storageMock';
import { installStorageMock } from '../../test/installStorageMock';
import type { TabType } from '../../types';
import {
  KEYWORDS_COUNT, getGroupChildIds, queryAttentionElement, queryFlyoutElement, renderSidebar, setupSeoEntryClicked, setupSeoGroupClick
} from './Sidebar-fixtures';
import { publishSettingsAttention } from './settingsAttention';
import type { SettingsTab } from '../Settings/settingsSections';
import { SIDEBAR_COLLAPSED_STORAGE_KEY } from './useSidebarCollapsed';

vi.mock('../../hooks/useIsAdmin', () => import('../../test/useIsAdminMock'));

const storage = createStorageMock();

beforeEach(() => {
  installStorageMock(storage);
  mockAdminRole(true);
  publishSettingsAttention([]);
});

describe('Sidebar groups while their page is open', () => {
  it('opens the SEO group with every SEO page, the overview being the SEO entry itself', () => {
    renderSidebar('seo', '/seo/backlinks');

    expect(getGroupChildIds('SEO')).toStrictEqual(['domain', 'backlinks', 'rank-tracking', 'site-audit', 'performance', 'local']);
  });

  it('does not mark the SEO entry as current while one of its pages is open', () => {
    renderSidebar('seo', '/seo/backlinks');

    expect(screen.getByRole('link', { name: 'SEO' })).not.toHaveAttribute('aria-current');
  });

  it.each<[TabType, string, RegExp]>([
    ['seo', '/seo/backlinks', /^Backlinks$/],
    ['seo', '/seo', /^SEO$/],
    ['settings', '/settings', /^Keywords/],
    ['settings', '/settings/alerts', /^Alerts$/],
  ])('marks the page of %s %s as current', (tab, path, name) => {
    renderSidebar(tab, path);

    expect(screen.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
  });

  it('lists every Settings section for an admin, in order', () => {
    renderSidebar('settings', '/settings/alerts');

    expect(getGroupChildIds('Settings')).toStrictEqual([
      'keywords', 'markets', 'brand-config', 'query-prompts', 'providers', 'bedrock-models', 'alerts', 'users', 'ai-assistants',
    ]);
  });

  it('leaves the admin-only sections out for a plain user', () => {
    mockAdminRole(false);

    renderSidebar('settings', '/settings');

    expect(getGroupChildIds('Settings')).toStrictEqual(['keywords', 'markets', 'brand-config', 'query-prompts', 'providers', 'alerts', 'ai-assistants']);
  });

  it('shows the keyword count beside Keywords', () => {
    renderSidebar('settings', '/settings');

    expect(screen.getByRole('link', { name: /^Keywords/ })).toHaveTextContent(`Keywords${KEYWORDS_COUNT}`);
  });

  it('keeps the other group closed', () => {
    renderSidebar('seo', '/seo');

    expect(screen.getByRole('button', { name: 'Show Settings pages' })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('Sidebar group navigation', () => {
  it('opens a page through the leave check when a child is clicked', async () => {
    const { onNavigate } = await setupSeoGroupClick('link', 'Site Audit');

    expect(onNavigate).toHaveBeenCalledWith('/seo/site-audit');
  });

  it('opens the group root when the group entry is clicked', async () => {
    const { onNavigate } = await setupSeoEntryClicked();

    expect(onNavigate).toHaveBeenCalledWith('/seo');
  });

  it('hides the pages of an open group from its chevron', async () => {
    await setupSeoGroupClick('button', 'Hide SEO pages');

    expect(screen.queryByRole('link', { name: 'Backlinks' })).not.toBeInTheDocument();
  });

  it('opens one group at a time from the chevrons', async () => {
    await setupSeoGroupClick('button', 'Show Settings pages');

    expect(screen.getByRole('button', { name: 'Show SEO pages' })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('Sidebar attention dots', () => {
  it('flags Keywords while there is no keyword', () => {
    renderSidebar('settings', '/settings', 0);

    expect(queryAttentionElement('Keywords')).toBeInTheDocument();
  });

  it.each<[SettingsTab, TabType, string]>([
    ['providers', 'settings', 'AI providers'],
    ['brand-config', 'citations', 'Settings'],
  ])('flags %s, published by the Settings page, on the %s tab at %s', (section, tab, label) => {
    publishSettingsAttention([section]);

    renderSidebar(tab, tab === 'settings' ? '/settings' : '/citations');

    expect(queryAttentionElement(label)).toBeInTheDocument();
  });

  it('updates when the Settings page publishes a change', () => {
    renderSidebar('settings', '/settings');

    act(() => publishSettingsAttention(['providers']));

    expect(screen.getAllByRole('status', { name: 'Needs configuration' })).toHaveLength(1);
  });
});

describe('Sidebar groups on the collapsed rail', () => {
  beforeEach(() => {
    storage.store[SIDEBAR_COLLAPSED_STORAGE_KEY] = 'true';
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } satisfies Pick<MediaQueryList, 'matches'> as MediaQueryList);
  });

  it('opens a pop-out of the group pages', async () => {
    await setupSeoEntryClicked();

    expect(queryFlyoutElement()).toBeInTheDocument();
  });

  it('does not navigate when the entry opens the pop-out', async () => {
    const { onNavigate } = await setupSeoEntryClicked();

    expect(onNavigate).not.toHaveBeenCalledWith('/seo');
  });

  it('lists the overview first in the pop-out, where the entry does not open it', async () => {
    await setupSeoEntryClicked();

    expect(within(queryFlyoutElement() ?? document.body).getAllByRole('link')[0]).toHaveTextContent('Overview');
  });

  it('opens the page chosen in the pop-out', async () => {
    const {
      user, onNavigate
    } = await setupSeoEntryClicked();

    await user.click(screen.getAllByRole('link', { name: 'Backlinks' })[0]);

    expect(onNavigate).toHaveBeenCalledWith('/seo/backlinks');
  });

  it.each<[string, (user: ReturnType<typeof userEvent.setup>) => Promise<void>]>([
    ['a choice', (user) => user.click(screen.getAllByRole('link', { name: 'Backlinks' })[0])],
    ['Escape', (user) => user.keyboard('{Escape}')],
    ['a click outside it', (user) => user.click(document.body)],
  ])('closes the pop-out on %s', async (_trigger, act) => {
    const { user } = await setupSeoEntryClicked();

    await act(user);

    expect(queryFlyoutElement()).not.toBeInTheDocument();
  });
});
