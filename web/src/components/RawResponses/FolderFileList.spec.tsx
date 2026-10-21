import {
  describe, it, expect, vi
} from 'vitest';
import {
  render, screen, fireEvent
} from '@testing-library/react';
import { FolderFileList } from './FolderFileList';
import { buildFile } from './FileViewer-fixtures';

const listing = {
  folders: [],
  files: [buildFile()],
  total_folders: 0,
  total_files: 1,
};

describe('FolderFileList', () => {
  it('shows no load-more button when the folder is fully loaded', () => {
    render(<FolderFileList browseData={listing} onFolderClick={vi.fn()} onFileClick={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('asks for the next page when load more is pressed', () => {
    const onLoadMore = vi.fn();
    render(<FolderFileList browseData={listing} onFolderClick={vi.fn()} onFileClick={vi.fn()} onLoadMore={onLoadMore} />);

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('disables the load-more button while the next page loads', () => {
    render(
      <FolderFileList browseData={listing} onFolderClick={vi.fn()} onFileClick={vi.fn()} onLoadMore={vi.fn()} loadingMore />
    );

    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();
  });

  it('says the counts are of the loaded entries while more remain', () => {
    render(<FolderFileList browseData={listing} onFolderClick={vi.fn()} onFileClick={vi.fn()} onLoadMore={vi.fn()} />);

    expect(screen.getByText('0 folders, 1 file loaded')).toBeInTheDocument();
  });
});
