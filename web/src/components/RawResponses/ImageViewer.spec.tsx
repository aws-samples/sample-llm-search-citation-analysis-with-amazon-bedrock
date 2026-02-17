import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen, fireEvent 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImageViewer } from './ImageViewer';
import type { S3Item } from '../../types';

function buildFile(overrides: Partial<S3Item> = {}): S3Item {
  return {
    name: 'screenshot.png',
    path: 'screenshots/screenshot.png',
    type: 'image',
    size: 51200,
    last_modified: '2024-01-15T10:30:00Z',
    ...overrides,
  };
}

describe('ImageViewer', () => {
  const defaultProps = {
    file: buildFile(),
    imageUrl: 'https://example.com/image.png',
    onDownload: vi.fn(),
    loading: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loading state', () => {
    it('shows loading spinner when loading is true', () => {
      render(<ImageViewer {...defaultProps} loading={true} />);

      expect(screen.getByText(/loading image/i)).toBeInTheDocument();
    });
  });

  describe('image header', () => {
    it('displays file name', () => {
      render(<ImageViewer {...defaultProps} />);

      expect(screen.getByText('screenshot.png')).toBeInTheDocument();
    });

    it('displays file size', () => {
      render(<ImageViewer {...defaultProps} />);

      expect(screen.getByText(/50\.0 KB/)).toBeInTheDocument();
    });

    it('calls onDownload when download button clicked', async () => {
      const onDownload = vi.fn();
      render(<ImageViewer {...defaultProps} onDownload={onDownload} />);

      await userEvent.click(screen.getByRole('button', { name: /download/i }));

      expect(onDownload).toHaveBeenCalledTimes(1);
    });
  });

  describe('image display', () => {
    it('renders image with correct src', () => {
      render(<ImageViewer {...defaultProps} />);

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', 'https://example.com/image.png');
    });

    it('renders image with alt text from file name', () => {
      render(<ImageViewer {...defaultProps} />);

      expect(screen.getByAltText('screenshot.png')).toBeInTheDocument();
    });

    it('shows error message when image fails to load', () => {
      render(<ImageViewer {...defaultProps} />);

      const img = screen.getByRole('img');
      fireEvent.error(img);

      expect(screen.getByText(/failed to load image/i)).toBeInTheDocument();
    });
  });

  describe('no image state', () => {
    it('shows no image message when imageUrl is null', () => {
      render(<ImageViewer {...defaultProps} imageUrl={null} />);

      expect(screen.getByText(/no image available/i)).toBeInTheDocument();
    });
  });
});
