import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { ContentBlockEditor } from './ContentBlockEditor';
import {
  newContentBlock, type ContentBlock
} from './contentBlocks';
import {
  buildHeadingBlock, buildImageBlock, buildTextBlock, buildVideoBlock, changeField
} from '../customReport-fixtures';

/** The editor of `block`, with a spy for its changes. */
function renderEditor(block: ContentBlock, { revealProblem = false } = {}) {
  const onChange = vi.fn();
  const view = render(<ContentBlockEditor block={block} onChange={onChange} revealProblem={revealProblem} />);
  return {
    onChange,
    rerenderBlock: (next: ContentBlock) => view.rerender(<ContentBlockEditor block={next} onChange={onChange} />),
  };
}

describe('ContentBlockEditor fields', () => {
  it.each([
    {
      block: buildHeadingBlock(),
      label: 'Heading text',
      value: 'Highlights',
      expected: buildHeadingBlock({ text: 'Highlights' }),
    },
    {
      block: buildTextBlock(),
      label: 'Text',
      value: 'New *copy*',
      expected: buildTextBlock({ markdown: 'New *copy*' }),
    },
    {
      block: buildImageBlock(),
      label: 'Image link',
      value: 'https://example.com/logo.png',
      expected: buildImageBlock({ url: 'https://example.com/logo.png' }),
    },
    {
      block: buildImageBlock(),
      label: 'Description',
      value: 'Our logo',
      expected: buildImageBlock({ alt: 'Our logo' }),
    },
    {
      block: buildImageBlock(),
      label: 'Caption (optional)',
      value: 'Brand mark',
      expected: buildImageBlock({ caption: 'Brand mark' }),
    },
    {
      block: buildVideoBlock(),
      label: 'Video link',
      value: 'https://vimeo.com/76979871',
      expected: buildVideoBlock({ url: 'https://vimeo.com/76979871' }),
    },
    {
      block: buildVideoBlock(),
      label: 'Caption (optional)',
      value: 'Short tour',
      expected: buildVideoBlock({ caption: 'Short tour' }),
    },
  ])('sends the $block.type block with the new value of "$label"', ({
    block, label, value, expected
  }) => {
    const { onChange } = renderEditor(block);

    changeField(label, value);

    expect(onChange).toHaveBeenCalledWith(expected);
  });

  it('sends a small heading when Small is picked', () => {
    const { onChange } = renderEditor(buildHeadingBlock());

    changeField('Size', '3');

    expect(onChange).toHaveBeenCalledWith(buildHeadingBlock({ level: 3 }));
  });

  it('shows the heading size as Large or Small', () => {
    renderEditor(buildHeadingBlock({ level: 3 }));

    expect(screen.getByRole('combobox', { name: 'Size' })).toHaveDisplayValue('Small');
  });

  it.each([
    {
      block: buildHeadingBlock(),
      label: 'Heading text',
      maxLength: '120',
    },
    {
      block: buildTextBlock(),
      label: 'Text',
      maxLength: '5000',
    },
    {
      block: buildImageBlock(),
      label: 'Description',
      maxLength: '200',
    },
    {
      block: buildVideoBlock(),
      label: 'Video link',
      maxLength: '2048',
    },
  ])('caps "$label" at $maxLength characters', ({
    block, label, maxLength
  }) => {
    renderEditor(block);

    expect(screen.getByLabelText(label)).toHaveAttribute('maxlength', maxLength);
  });
});

describe('ContentBlockEditor hints', () => {
  it.each([
    ['explains the markdown the text block understands', buildTextBlock(), 'Text', 'Markdown: **bold**, *italic*, lists, links and tables'],
    ['asks for a YouTube or Vimeo link', buildVideoBlock(), 'Video link', 'A YouTube or Vimeo link'],
  ])('%s', (_outcome, block, label, hint) => {
    renderEditor(block);

    expect(screen.getByLabelText(label)).toHaveAccessibleDescription(hint);
  });

  it('gives a six-row box for the text', () => {
    renderEditor(buildTextBlock());

    expect(screen.getByLabelText('Text')).toHaveAttribute('rows', '6');
  });

  it('counts the characters of the text against the limit', () => {
    renderEditor(buildTextBlock({ markdown: 'Hello world' }));

    expect(screen.getByText('11 / 5000')).toBeInTheDocument();
  });
});

describe('ContentBlockEditor problem', () => {
  describe('of a fresh heading', () => {
    it('does not flag a fresh block', () => {
      renderEditor(newContentBlock('heading'));

      expect(screen.queryByText('Add the heading text')).toBeNull();
      expect(screen.getByLabelText('Heading text')).toHaveAttribute('aria-invalid', 'false');
    });

    it('shows the problem once the user has typed in the block', () => {
      renderEditor(newContentBlock('heading'));

      changeField('Heading text', ' ');

      expect(screen.getByText('Add the heading text')).toBeInTheDocument();
    });

    it('shows the problem of an untouched block once a save was refused', () => {
      renderEditor(newContentBlock('heading'), { revealProblem: true });

      expect(screen.getByText('Add the heading text')).toBeInTheDocument();
    });

    it('keeps the problem hidden when only the heading size changed', () => {
      renderEditor(newContentBlock('heading'));

      changeField('Size', '3');

      expect(screen.queryByText('Add the heading text')).toBeNull();
    });
  });

  describe('of a fresh image once its caption is typed', () => {
    beforeEach(() => {
      renderEditor(newContentBlock('image'));
      changeField('Caption (optional)', 'Logo');
    });

    it('marks the field the problem is about and describes it with the problem', () => {
      const link = screen.getByLabelText('Image link');

      expect(link).toHaveAttribute('aria-invalid', 'true');
      expect(link).toHaveAccessibleDescription('An https link to the image Add the image link');
    });

    it('leaves the fields the problem is not about unmarked', () => {
      expect(screen.getByLabelText('Caption (optional)')).toHaveAttribute('aria-invalid', 'false');
    });
  });

  it('shows the problem of the block it is given after the user typed', () => {
    const { rerenderBlock } = renderEditor(newContentBlock('video'));

    changeField('Video link', 'https://example.com/clip.mp4');
    rerenderBlock(buildVideoBlock({ url: 'https://example.com/clip.mp4' }));

    expect(screen.getByText('Use a YouTube or Vimeo link')).toBeInTheDocument();
  });

  it('clears the problem once the block would save', () => {
    const { rerenderBlock } = renderEditor(newContentBlock('text'));

    changeField('Text', 'Done');
    rerenderBlock(buildTextBlock({ markdown: 'Done' }));

    expect(screen.queryByText('Add some text')).toBeNull();
  });
});
