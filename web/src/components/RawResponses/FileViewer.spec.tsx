import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileViewer } from './FileViewer';
import type {
  S3Item, RawResponseContent 
} from '../../types';

function buildFile(overrides: Partial<S3Item> = {}): S3Item {
  return {
    name: 'test-file.json',
    path: 'responses/test-file.json',
    type: 'file',
    size: 1024,
    last_modified: '2024-01-15T10:30:00Z',
    ...overrides,
  };
}

function buildContent(overrides: Partial<RawResponseContent> = {}): RawResponseContent {
  return {
    key: 'responses/test-file.json',
    content: 'test content',
    content_type: 'application/json',
    size: 1024,
    last_modified: '2024-01-15T10:30:00Z',
    is_json: true,
    ...overrides,
  };
}

function buildDocumentContent(): RawResponseContent {
  return {
    key: 'responses/test-file.json',
    content: {
      provider: 'openai',
      keyword: 'test keyword',
      timestamp: '2024-01-15T10:30:00Z',
      raw_api_response: {},
      extracted: {
        response_text: 'AI response text',
        citations: ['https://example.com'],
        brands: [],
      },
      metadata: {
        model: 'gpt-4',
        latency_ms: 150 
      },
    },
    content_type: 'application/json',
    size: 2048,
    last_modified: '2024-01-15T10:30:00Z',
    is_json: true,
  };
}

describe('FileViewer', () => {
  const defaultProps = {
    file: buildFile(),
    content: buildContent(),
    onDownload: vi.fn(),
    loading: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

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

      await userEvent.click(screen.getByRole('button', { name: /download/i }));

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
