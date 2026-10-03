import {
  describe, expect, it, vi 
} from 'vitest';
import { screen } from '@testing-library/react';
import { clickDownloadButton } from './DownloadButton-fixtures';

interface ViewerRenderOptions {
  loading?: boolean;
  onDownload?: () => void;
}

interface ViewerContract {
  /** What the viewer shows while its content loads. */
  loadingText: RegExp;
  /** The fixture file's name, shown in the header. */
  fileName: string;
  /** Renders the viewer on its fixture file with the given loading flag and download callback. */
  renderViewer: (options: ViewerRenderOptions) => void;
}

/** The loading state and header behaviour that FileViewer and ImageViewer share. */
export function describeViewerContract({
  loadingText, fileName, renderViewer 
}: ViewerContract): void {
  describe('loading state', () => {
    it('shows loading spinner when loading is true', () => {
      renderViewer({ loading: true });

      expect(screen.getByText(loadingText)).toBeInTheDocument();
    });
  });

  describe('header', () => {
    it('displays file name', () => {
      renderViewer({});

      expect(screen.getByText(fileName)).toBeInTheDocument();
    });

    it('calls onDownload when download button clicked', async () => {
      const onDownload = vi.fn();
      renderViewer({ onDownload });

      await clickDownloadButton();

      expect(onDownload).toHaveBeenCalledTimes(1);
    });
  });
}
