import {
  describe, expect, it, vi
} from 'vitest';
import {
  fireEvent, render, screen
} from '@testing-library/react';
import { ContentBlockEditor } from './ContentBlockEditor';
import { newContentBlock } from './contentBlocks';
import {
  buildHeadingBlock, buildImageBlock, buildTextBlock, buildVideoBlock
} from '../customReport-fixtures';

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
    const onChange = vi.fn();
    render(<ContentBlockEditor block={block} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(label), { target: { value } });

    expect(onChange).toHaveBeenCalledWith(expected);
  });

  it('sends a small heading when Small is picked', () => {
    const onChange = vi.fn();
    render(<ContentBlockEditor block={buildHeadingBlock()} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '3' } });

    expect(onChange).toHaveBeenCalledWith(buildHeadingBlock({ level: 3 }));
  });

  it('shows the heading size as Large or Small', () => {
    render(<ContentBlockEditor block={buildHeadingBlock({ level: 3 })} onChange={vi.fn()} />);

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
    render(<ContentBlockEditor block={block} onChange={vi.fn()} />);

    expect(screen.getByLabelText(label)).toHaveAttribute('maxlength', maxLength);
  });
});

describe('ContentBlockEditor hints', () => {
  it('explains the markdown the text block understands', () => {
    render(<ContentBlockEditor block={buildTextBlock()} onChange={vi.fn()} />);

    expect(screen.getByLabelText('Text')).toHaveAccessibleDescription('Markdown: **bold**, *italic*, lists, links and tables');
  });

  it('gives a six-row box for the text', () => {
    render(<ContentBlockEditor block={buildTextBlock()} onChange={vi.fn()} />);

    expect(screen.getByLabelText('Text')).toHaveAttribute('rows', '6');
  });

  it('counts the characters of the text against the limit', () => {
    render(<ContentBlockEditor block={buildTextBlock({ markdown: 'Hello world' })} onChange={vi.fn()} />);

    expect(screen.getByText('11 / 5000')).toBeInTheDocument();
  });

  it('asks for a YouTube or Vimeo link', () => {
    render(<ContentBlockEditor block={buildVideoBlock()} onChange={vi.fn()} />);

    expect(screen.getByLabelText('Video link')).toHaveAccessibleDescription('A YouTube or Vimeo link');
  });
});

describe('ContentBlockEditor problem', () => {
  it('does not flag a fresh block', () => {
    render(<ContentBlockEditor block={newContentBlock('heading')} onChange={vi.fn()} />);

    expect(screen.queryByText('Add the heading text')).toBeNull();
    expect(screen.getByLabelText('Heading text')).toHaveAttribute('aria-invalid', 'false');
  });

  it('shows the problem once the user has typed in the block', () => {
    render(<ContentBlockEditor block={newContentBlock('heading')} onChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Heading text'), { target: { value: ' ' } });

    expect(screen.getByText('Add the heading text')).toBeInTheDocument();
  });

  it('shows the problem of an untouched block once a save was refused', () => {
    render(<ContentBlockEditor block={newContentBlock('heading')} onChange={vi.fn()} revealProblem />);

    expect(screen.getByText('Add the heading text')).toBeInTheDocument();
  });

  it('marks the field the problem is about and describes it with the problem', () => {
    render(<ContentBlockEditor block={newContentBlock('image')} onChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Caption (optional)'), { target: { value: 'Logo' } });
    const link = screen.getByLabelText('Image link');

    expect(link).toHaveAttribute('aria-invalid', 'true');
    expect(link).toHaveAccessibleDescription('An https link to the image Add the image link');
  });

  it('leaves the fields the problem is not about unmarked', () => {
    render(<ContentBlockEditor block={newContentBlock('image')} onChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Caption (optional)'), { target: { value: 'Logo' } });

    expect(screen.getByLabelText('Caption (optional)')).toHaveAttribute('aria-invalid', 'false');
  });

  it('keeps the problem hidden when only the heading size changed', () => {
    render(<ContentBlockEditor block={newContentBlock('heading')} onChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '3' } });

    expect(screen.queryByText('Add the heading text')).toBeNull();
  });

  it('shows the problem of the block it is given after the user typed', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ContentBlockEditor block={newContentBlock('video')} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Video link'), { target: { value: 'https://example.com/clip.mp4' } });
    rerender(<ContentBlockEditor block={buildVideoBlock({ url: 'https://example.com/clip.mp4' })} onChange={onChange} />);

    expect(screen.getByText('Use a YouTube or Vimeo link')).toBeInTheDocument();
  });

  it('clears the problem once the block would save', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ContentBlockEditor block={newContentBlock('text')} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Done' } });
    rerender(<ContentBlockEditor block={buildTextBlock({ markdown: 'Done' })} onChange={onChange} />);

    expect(screen.queryByText('Add some text')).toBeNull();
  });
});
