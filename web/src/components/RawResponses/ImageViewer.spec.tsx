import {
  describe, it, expect, vi 
} from 'vitest';
import {
  render, screen, fireEvent 
} from '@testing-library/react';
import type { ComponentProps } from 'react';
import { ImageViewer } from './ImageViewer';
import { describeViewerContract } from './ViewerHeader-fixtures';
import { buildImageFile } from './ImageViewer-fixtures';

/** Renders the viewer on the fixture screenshot, idle, with `overrides` applied. */
function renderImageViewer(overrides: Partial<ComponentProps<typeof ImageViewer>> = {}): void {
  render(
    <ImageViewer
      file={buildImageFile()}
      imageUrl="https://example.com/image.png"
      onDownload={vi.fn()}
      loading={false}
      {...overrides}
    />
  );
}

describe('ImageViewer', () => {
  describeViewerContract({
    loadingText: /loading image/i,
    fileName: 'screenshot.png',
    renderViewer: renderImageViewer,
  });

  describe('image header', () => {
    it('displays file size', () => {
      renderImageViewer();

      expect(screen.getByText(/50\.0 KB/)).toBeInTheDocument();
    });
  });

  describe('image display', () => {
    it('renders image with correct src', () => {
      renderImageViewer();

      expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/image.png');
    });

    it('renders image with alt text from file name', () => {
      renderImageViewer();

      expect(screen.getByAltText('screenshot.png')).toBeInTheDocument();
    });

    it('shows error message when image fails to load', () => {
      renderImageViewer();

      fireEvent.error(screen.getByRole('img'));

      expect(screen.getByText(/failed to load image/i)).toBeInTheDocument();
    });
  });

  describe('no image state', () => {
    it('shows no image message when imageUrl is null', () => {
      renderImageViewer({ imageUrl: null });

      expect(screen.getByText(/no image available/i)).toBeInTheDocument();
    });
  });
});
