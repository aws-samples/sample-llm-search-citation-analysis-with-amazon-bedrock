import {
  describe, it, expect, vi 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import type { ComponentProps } from 'react';
import { FileViewer } from './FileViewer';
import { describeViewerContract } from './ViewerHeader-fixtures';
import {
  buildContent, buildDocumentContent, buildFile
} from './FileViewer-fixtures';

/** Renders the viewer on the fixture JSON file, idle, with `overrides` applied. */
function renderFileViewer(overrides: Partial<ComponentProps<typeof FileViewer>> = {}): void {
  render(
    <FileViewer
      file={buildFile()}
      content={buildContent()}
      onDownload={vi.fn()}
      loading={false}
      {...overrides}
    />
  );
}

describe('FileViewer', () => {
  describeViewerContract({
    loadingText: /loading file/i,
    fileName: 'test-file.json',
    renderViewer: renderFileViewer,
  });

  describe('raw content display', () => {
    it('displays plain text for non-JSON content', () => {
      renderFileViewer({
        content: buildContent({
          is_json: false,
          content: 'plain text content',
        }),
      });

      expect(screen.getByText('plain text content')).toBeInTheDocument();
    });
  });

  describe('document content display', () => {
    it.each([
      ['provider badge', 'openai'],
      ['keyword', 'test keyword'],
      ['latency', '150ms'],
    ])('displays %s for document content', (_field, text) => {
      renderFileViewer({ content: buildDocumentContent() });

      expect(screen.getByText(text)).toBeInTheDocument();
    });

    it.each([
      ['openai', 'bg-green-100'],
      ['perplexity', 'bg-orange-100'],
      ['gemini', 'bg-blue-100'],
      ['claude', 'bg-purple-100'],
    ])('tints the %s provider badge %s, the colour the provider has across the dashboard', (provider, tint) => {
      renderFileViewer({ content: buildDocumentContent(provider) });

      expect(screen.getByText(provider)).toHaveClass(tint);
    });
  });
});
