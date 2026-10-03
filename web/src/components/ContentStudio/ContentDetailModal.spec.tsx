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
  incompleteMetadataWarning,
  whitespaceGeneratedTitleOverrides,
} from './ContentStudioHistory-fixtures';

vi.mock('../../exporters/documentGenerator', () => ({ exportToDocx: vi.fn() }));

const mockExportToDocx = vi.mocked(exportToDocx);

function renderContentDetailModal(
  overrides: Parameters<typeof buildContentStudioHistory>[0],
  onCopy?: (text: string) => void
) {
  const item = buildContentStudioHistory(overrides);
  render(<ContentDetailModal {...createContentDetailModalProps(item, onCopy)} />);
  return item;
}

describe('ContentDetailModal', () => {
  it('renders trimmed idea title when generated title contains only whitespace', () => {
    renderContentDetailModal(whitespaceGeneratedTitleOverrides);

    expect(screen.getByRole('heading', { name: 'Useful idea title' })).toBeInTheDocument();
  });

  it('uses trimmed idea title in exported draft when generated title is whitespace', async () => {
    mockExportToDocx.mockResolvedValue(undefined);
    const item = renderContentDetailModal(whitespaceGeneratedTitleOverrides);

    await userEvent.click(screen.getByTitle('Download as Word document'));

    expect(mockExportToDocx).toHaveBeenCalledWith({
      content: {
        ...item.generated_content,
        title: 'Useful idea title',
      },
      keyword: item.keyword,
    });
  });

  it('logs a failed Word export', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const failure = new TypeError('Document failed');
    mockExportToDocx.mockRejectedValue(failure);
    renderContentDetailModal(whitespaceGeneratedTitleOverrides);

    await userEvent.click(screen.getByTitle('Download as Word document'));

    expect(consoleError).toHaveBeenCalledWith('Error exporting to DOCX:', failure);
  });

  it('uses keyword in copied draft when generated and idea titles are blank', async () => {
    const onCopy = vi.fn();
    renderContentDetailModal({
      keyword: '  fallback keyword  ',
      idea_title: '',
      generated_content: {
        title: ' ',
        meta_description: 'Meta text',
        body: 'Useful body',
      },
    }, onCopy);

    await userEvent.click(screen.getByRole('button', { name: 'Copy All' }));

    expect(onCopy).toHaveBeenCalledWith('# fallback keyword\n\nMeta text\n\nUseful body');
  });

  it('shows incomplete-metadata warning when warning is propagated', () => {
    renderContentDetailModal({ content_warning: incompleteMetadataWarning });

    expect(screen.getByRole('status')).toHaveTextContent(incompleteMetadataWarning.message);
  });

  it('keeps useful draft visible when incomplete-metadata warning is propagated', () => {
    renderContentDetailModal({
      content_warning: incompleteMetadataWarning,
      generated_content: { body: '## Useful section\n\nUseful draft body remains visible.' },
    });

    expect(screen.getByText('Useful draft body remains visible.')).toBeInTheDocument();
  });
});
