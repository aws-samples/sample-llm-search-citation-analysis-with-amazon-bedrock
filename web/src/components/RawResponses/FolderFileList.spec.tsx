import {
  describe, it, expect, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import type { S3Item } from '../../types';
import { FolderFileList } from './FolderFileList';
import { buildFile } from './FileViewer-fixtures';
import { itPagesWithLoadMoreButton } from '../ui/LoadMoreButton-fixtures';
import {
  buildDayFolders, buildFolderListing
} from './FolderFileList-fixtures';

const listing = {
  folders: [] as S3Item[],
  files: [buildFile()],
  total_folders: 0,
  total_files: 1,
};

function renderDayFolders(count: number, props: Partial<ComponentProps<typeof FolderFileList>> = {}) {
  return render(<FolderFileList browseData={buildFolderListing(buildDayFolders(count))} onFolderClick={vi.fn()} onFileClick={vi.fn()} {...props} />);
}

async function setupAllDaysShown(props: Partial<ComponentProps<typeof FolderFileList>> = {}) {
  renderDayFolders(40, props);
  await userEvent.click(screen.getByRole('button', { name: 'Show all 40 days' }));
}

async function setupFilteredDays(query: string) {
  renderDayFolders(40);
  await userEvent.type(screen.getByRole('searchbox', { name: 'Filter loaded entries' }), query);
}

describe('FolderFileList', () => {
  itPagesWithLoadMoreButton('Load more', (props) => render(
    <FolderFileList browseData={listing} onFolderClick={vi.fn()} onFileClick={vi.fn()} {...props} />
  ));

  it('says the counts are of the loaded entries while more remain', () => {
    render(<FolderFileList browseData={listing} onFolderClick={vi.fn()} onFileClick={vi.fn()} onLoadMore={vi.fn()} />);

    expect(screen.getByText('0 folders, 1 file loaded')).toBeInTheDocument();
  });

  it('opens a folder from the keyboard with Enter', async () => {
    const folder: S3Item = {
      name: '2024-01-15',
      path: 'responses/2024-01-15/',
      type: 'folder',
    };
    const onFolderClick = vi.fn();
    render(<FolderFileList browseData={{
      ...listing,
      folders: [folder] 
    }} onFolderClick={onFolderClick} onFileClick={vi.fn()} />);

    await userEvent.tab();
    expect(screen.getByRole('button', { name: /2024-01-15/ })).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    expect(onFolderClick).toHaveBeenCalledWith(folder);
  });

  it('opens a file from the keyboard with Space', async () => {
    const onFileClick = vi.fn();
    render(<FolderFileList browseData={listing} onFolderClick={vi.fn()} onFileClick={onFileClick} />);

    screen.getByRole('button', { name: /test-file\.json/ }).focus();
    await userEvent.keyboard(' ');

    expect(onFileClick).toHaveBeenCalledWith(listing.files[0]);
  });

  it('shows the latest ten run days first', () => {
    renderDayFolders(40);

    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    expect(screen.getByText('Showing the latest 10 · 40 folders, 0 files')).toBeInTheDocument();
  });

  it('shows every loaded run day, grouped by month, once Show all is pressed', async () => {
    await setupAllDaysShown();

    expect(screen.getAllByRole('listitem')).toHaveLength(40);
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeInTheDocument();
  });

  it('names a run-day folder by its readable date and its folder name', () => {
    renderDayFolders(1);

    expect(screen.getByRole('button', { name: /Mon 26 Oct 2026\s*2026-10-26/ })).toBeInTheDocument();
  });

  it('holds Load more back while only the latest days are shown', () => {
    renderDayFolders(40, { onLoadMore: vi.fn() });

    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('offers Load more once every loaded entry is shown', async () => {
    await setupAllDaysShown({ onLoadMore: vi.fn() });

    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
  });

  it('counts the whole folder while pages remain', () => {
    render(<FolderFileList browseData={{
      ...buildFolderListing(buildDayFolders(5)),
      folder_count: 1_200,
      file_count: 0,
    }} onFolderClick={vi.fn()} onFileClick={vi.fn()} onLoadMore={vi.fn()} />);

    expect(screen.getByText('5 of 1,200 entries loaded')).toBeInTheDocument();
  });

  it('filters the loaded entries by date, past the latest ten', async () => {
    await setupFilteredDays('Sep');

    expect(screen.getAllByRole('listitem')).toHaveLength(14);
  });

  it('says when no loaded entry matches the filter', async () => {
    await setupFilteredDays('zzz');

    expect(screen.getByText('No entries match “zzz”.')).toBeInTheDocument();
  });

  it('warns when the folder was too large to list in full', () => {
    render(<FolderFileList browseData={buildFolderListing(buildDayFolders(2), { truncated: true })} onFolderClick={vi.fn()} onFileClick={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('newest entries may be missing');
  });
});
