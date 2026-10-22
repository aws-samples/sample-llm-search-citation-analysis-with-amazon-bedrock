import {
  describe, it, expect, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { FolderFileList } from './FolderFileList';
import { buildFile } from './FileViewer-fixtures';
import { itPagesWithLoadMoreButton } from '../ui/LoadMoreButton-fixtures';

const listing = {
  folders: [],
  files: [buildFile()],
  total_folders: 0,
  total_files: 1,
};

describe('FolderFileList', () => {
  itPagesWithLoadMoreButton('Load more', (props) => render(
    <FolderFileList browseData={listing} onFolderClick={vi.fn()} onFileClick={vi.fn()} {...props} />
  ));

  it('says the counts are of the loaded entries while more remain', () => {
    render(<FolderFileList browseData={listing} onFolderClick={vi.fn()} onFileClick={vi.fn()} onLoadMore={vi.fn()} />);

    expect(screen.getByText('0 folders, 1 file loaded')).toBeInTheDocument();
  });
});
