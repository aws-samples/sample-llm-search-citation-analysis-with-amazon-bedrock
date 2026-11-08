import {
  render, screen, waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect } from 'vitest';
import { fetchBacklinksTable } from '../../../api/seoBacklinks';
import type { BacklinksTableRequest } from '../../../types/api/seoBacklinks';
import { MemoryRouter } from 'react-router-dom';
import { BacklinksView } from './BacklinksView';

export const SOURCE_DOMAIN = 'blog.example.org';

/** Renders the page and waits for the stored snapshots (the only request made on mount). */
export async function renderBacklinksView() {
  const user = userEvent.setup();
  render(<BacklinksView />, { wrapper: MemoryRouter });
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Authority over time' })).toBeInTheDocument();
  });
  return user;
}

/** Types `target` and presses Search. */
export async function submitTarget(user: ReturnType<typeof userEvent.setup>, target: string) {
  await user.type(screen.getByLabelText('Domain or URL'), target);
  await user.click(screen.getByRole('button', { name: 'Search' }));
}

/** Searches `target` and waits for the overview metrics. */
export async function searchTarget(user: ReturnType<typeof userEvent.setup>, target: string) {
  await submitTarget(user, target);
  await waitFor(() => {
    expect(screen.getByText('Referring pages')).toBeInTheDocument();
  });
}

/** Renders the page and searches `example.com`, ready to work on its tables. */
export async function renderSearched() {
  const user = await renderBacklinksView();
  await searchTarget(user, 'example.com');
  return user;
}

/** Searches `example.com` and waits until its first table page can be exported. */
export async function renderExportReady() {
  const user = await renderSearched();
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Export to Excel' })).toBeEnabled();
  });
  return user;
}

/** Searches `example.com`, waits for its first table page and opens its export dialog. */
export async function openBacklinksExport() {
  const user = await renderExportReady();
  await user.click(screen.getByRole('button', { name: 'Export to Excel' }));
  return user;
}

/** Opens the export dialog of the table on screen and presses its Download. */
export async function clickExportDownload(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Export to Excel' }));
  await user.click(screen.getByRole('button', { name: 'Download' }));
}

/** Opens the export dialog of the first backlinks page and presses `button` in it. */
export async function downloadBacklinksExport(button: string) {
  const user = await openBacklinksExport();
  await user.click(screen.getByRole('button', { name: button }));
}

/** Searches `example.com`, ticks "Include likely spam" and waits for the page that includes it. */
export async function renderSpamIncluded() {
  const user = await renderSearched();
  await user.click(await screen.findByRole('checkbox', { name: /Include likely spam/ }));
  await waitForLastTableRequest({ include_spam: true });
  return user;
}

/** The chevron that shows or hides every link from `SOURCE_DOMAIN`. */
export function findExpandButton(action: 'Show' | 'Hide') {
  return screen.findByRole('button', { name: `${action} all links from ${SOURCE_DOMAIN}` });
}

/** Searches `example.com` and expands `SOURCE_DOMAIN` in the one-per-domain table. */
export async function renderExpanded() {
  const user = await renderSearched();
  await user.click(await findExpandButton('Show'));
  return user;
}

/** Waits until the latest backlinks page request carries `fields`. */
export async function waitForLastTableRequest(fields: Partial<BacklinksTableRequest>) {
  await waitFor(() => {
    expect(fetchBacklinksTable).toHaveBeenLastCalledWith('backlinks', expect.objectContaining(fields), expect.anything());
  });
}

