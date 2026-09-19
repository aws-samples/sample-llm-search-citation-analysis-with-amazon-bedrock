import {
  describe, it, expect, vi 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { FileViewer } from './FileViewer';
import { clickDownloadButton } from './DownloadButton-fixtures';
import {
  buildContent, buildDocumentContent, buildFile
} from './FileViewer-fixtures';

describe('FileViewer', () => {
  const defaultProps = {
    file: buildFile(),
    content: buildContent(),
    onDownload: vi.fn(),
    loading: false,
  };

  describe('loading state', () => {
    it('shows loading spinner when loading is true', () => {
      render(<FileViewer {...defaultProps} loading={true} />);

      expect(screen.getByText(/loading file/i)).toBeInTheDocument();
    });
  });

  describe('file header', () => {
    it('displays file name', () => {
      render(<FileViewer {...defaultProps} />);

      expect(screen.getByText('test-file.json')).toBeInTheDocument();
    });

    it('calls onDownload when download button clicked', async () => {
      const onDownload = vi.fn();
      render(<FileViewer {...defaultProps} onDownload={onDownload} />);

      await clickDownloadButton();

      expect(onDownload).toHaveBeenCalledTimes(1);
    });
  });

  describe('raw content display', () => {
    it('displays plain text for non-JSON content', () => {
      const content = buildContent({
        is_json: false,
        content: 'plain text content',
      });
      render(<FileViewer {...defaultProps} content={content} />);

      expect(screen.getByText('plain text content')).toBeInTheDocument();
    });
  });

  describe('document content display', () => {
    it('displays provider badge for document content', () => {
      render(<FileViewer {...defaultProps} content={buildDocumentContent()} />);

      expect(screen.getByText('openai')).toBeInTheDocument();
    });

    it('displays keyword for document content', () => {
      render(<FileViewer {...defaultProps} content={buildDocumentContent()} />);

      expect(screen.getByText('test keyword')).toBeInTheDocument();
    });

    it('displays latency for document content', () => {
      render(<FileViewer {...defaultProps} content={buildDocumentContent()} />);

      expect(screen.getByText('150ms')).toBeInTheDocument();
    });
  });
});
