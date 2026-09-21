import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { exportToDocx } from '../../exporters/documentGenerator';
import { ContentDetailModal } from './ContentDetailModal';
import {
  buildContentStudioHistory,
  createContentDetailModalProps,
  incompleteMetadataWarning
} from './ContentStudioHistory-fixtures';

vi.mock('../../exporters/documentGenerator', () => ({ exportToDocx: vi.fn() }));

const mockExportToDocx = vi.mocked(exportToDocx);

describe('ContentDetailModal', () => {
  it('renders trimmed idea title when generated title contains only whitespace', () => {
    const item = buildContentStudioHistory({
      idea_title: '  Useful idea title  ',
      generated_content: { title: '   ' },
    });

    render(<ContentDetailModal {...createContentDetailModalProps(item)} />);

    expect(screen.getByRole('heading', { name: 'Useful idea title' })).toBeInTheDocument();
  });

  it('uses trimmed idea title in exported draft when generated title is whitespace', async () => {
    mockExportToDocx.mockClear();
    mockExportToDocx.mockResolvedValue(undefined);
    const item = buildContentStudioHistory({
      idea_title: '  Useful idea title  ',
      generated_content: { title: '   ' },
    });
    render(<ContentDetailModal {...createContentDetailModalProps(item)} />);

    await userEvent.click(screen.getByTitle('Download as Word document'));

    expect(mockExportToDocx).toHaveBeenCalledWith({
      content: {
        ...item.generated_content,
        title: 'Useful idea title',
      },
      keyword: item.keyword,
    });
  });

  it('uses keyword in copied draft when generated and idea titles are blank', async () => {
    const onCopy = vi.fn();
    const item = buildContentStudioHistory({
      keyword: '  fallback keyword  ',
      idea_title: '',
      generated_content: {
        title: ' ',
        meta_description: 'Meta text',
        body: 'Useful body',
      },
    });
    render(<ContentDetailModal {...createContentDetailModalProps(item, onCopy)} />);

    await userEvent.click(screen.getByRole('button', { name: 'Copy All' }));

    expect(onCopy).toHaveBeenCalledWith('# fallback keyword\n\nMeta text\n\nUseful body');
  });

  it('shows incomplete-metadata warning when warning is propagated', () => {
    const item = buildContentStudioHistory({ content_warning: incompleteMetadataWarning });

    render(<ContentDetailModal {...createContentDetailModalProps(item)} />);

    expect(screen.getByRole('status')).toHaveTextContent(incompleteMetadataWarning.message);
  });

  it('keeps useful draft visible when incomplete-metadata warning is propagated', () => {
    const item = buildContentStudioHistory({
      content_warning: incompleteMetadataWarning,
      generated_content: { body: '## Useful section\n\nUseful draft body remains visible.' },
    });

    render(<ContentDetailModal {...createContentDetailModalProps(item)} />);

    expect(screen.getByText('Useful draft body remains visible.')).toBeInTheDocument();
  });
});
