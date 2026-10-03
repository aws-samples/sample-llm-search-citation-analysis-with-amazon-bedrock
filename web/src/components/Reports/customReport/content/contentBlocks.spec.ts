import {
  describe, expect, it
} from 'vitest';
import {
  CONTENT_BLOCK_TYPES,
  MAX_ALT_LENGTH,
  MAX_CAPTION_LENGTH,
  MAX_HEADING_LENGTH,
  MAX_TEXT_LENGTH,
  contentBlockIssue,
  contentBlockPayload,
  contentBlockProblem,
  isContentBlock,
  newContentBlock,
} from './contentBlocks';
import type { ContentBlock } from './contentBlocks';
import { MAX_MEDIA_URL_LENGTH } from './mediaLinks';
import {
  buildHeadingBlock, buildImageBlock, buildTextBlock, buildVideoBlock
} from '../customReport-fixtures';

const VALID_BLOCKS: readonly ContentBlock[] = [
  buildHeadingBlock(),
  buildHeadingBlock({ level: 3 }),
  buildTextBlock(),
  buildImageBlock(),
  buildImageBlock({ caption: undefined }),
  buildVideoBlock(),
  buildVideoBlock({ url: 'https://vimeo.com/76979871' }),
];

const TOO_LONG_LINK = `https://example.com/${'a'.repeat(MAX_MEDIA_URL_LENGTH)}`;

describe('isContentBlock', () => {
  it.each(VALID_BLOCKS)('accepts a well-formed $type block', (block) => {
    expect(isContentBlock(block)).toBe(true);
  });

  it.each([
    {
      description: 'a data block',
      block: { type: 'sentiment_headline' },
    },
    {
      description: 'a heading of level 1',
      block: {
        type: 'heading',
        text: 'Title',
        level: 1,
      },
    },
    {
      description: 'a heading whose text is a number',
      block: {
        type: 'heading',
        text: 42,
        level: 2,
      },
    },
    {
      description: 'a text block without markdown',
      block: { type: 'text' },
    },
    {
      description: 'an image without a description',
      block: {
        type: 'image',
        url: 'https://example.com/logo.png',
      },
    },
    {
      description: 'an image whose caption is a number',
      block: {
        type: 'image',
        url: 'https://example.com/logo.png',
        alt: 'Logo',
        caption: 7,
      },
    },
    {
      description: 'a video without a link',
      block: {
        type: 'video',
        caption: 'Walkthrough',
      },
    },
    {
      description: 'a block named after an object prototype key',
      block: { type: 'constructor' },
    },
  ])('rejects $description', ({ block }) => {
    expect(isContentBlock(block)).toBe(false);
  });
});

describe('newContentBlock', () => {
  it('lists the four content block types', () => {
    expect(CONTENT_BLOCK_TYPES).toStrictEqual(['heading', 'text', 'image', 'video']);
  });

  it.each([
    {
      type: 'heading' as const,
      expected: {
        type: 'heading',
        text: '',
        level: 2,
      },
    },
    {
      type: 'text' as const,
      expected: {
        type: 'text',
        markdown: '',
      },
    },
    {
      type: 'image' as const,
      expected: {
        type: 'image',
        url: '',
        alt: '',
        caption: '',
      },
    },
    {
      type: 'video' as const,
      expected: {
        type: 'video',
        url: '',
        caption: '',
      },
    },
  ])('starts an empty $type block', ({
    type, expected
  }) => {
    expect(newContentBlock(type)).toStrictEqual(expected);
  });
});

describe('contentBlockProblem', () => {
  it.each(VALID_BLOCKS)('returns null for a $type block that would save', (block) => {
    expect(contentBlockProblem(block)).toBeNull();
  });

  it.each([
    {
      block: buildHeadingBlock({ text: '   ' }),
      message: 'Add the heading text',
    },
    {
      block: buildHeadingBlock({ text: 'h'.repeat(MAX_HEADING_LENGTH + 1) }),
      message: 'Keep the heading under 120 characters',
    },
    {
      block: buildTextBlock({ markdown: '\n\n' }),
      message: 'Add some text',
    },
    {
      block: buildTextBlock({ markdown: 't'.repeat(MAX_TEXT_LENGTH + 1) }),
      message: 'Keep the text under 5000 characters',
    },
    {
      block: buildImageBlock({ url: '' }),
      message: 'Add the image link',
    },
    {
      block: buildImageBlock({ url: TOO_LONG_LINK }),
      message: 'Keep the link under 2048 characters',
    },
    {
      block: buildImageBlock({ url: 'http://example.com/logo.png' }),
      message: 'Use an https image link',
    },
    {
      block: buildImageBlock({ alt: ' ' }),
      message: 'Describe the image for people who cannot see it',
    },
    {
      block: buildImageBlock({ alt: 'a'.repeat(MAX_ALT_LENGTH + 1) }),
      message: 'Keep the description under 200 characters',
    },
    {
      block: buildImageBlock({ caption: 'c'.repeat(MAX_CAPTION_LENGTH + 1) }),
      message: 'Keep the caption under 200 characters',
    },
    {
      block: buildVideoBlock({ url: ' ' }),
      message: 'Add the video link',
    },
    {
      block: buildVideoBlock({ url: TOO_LONG_LINK }),
      message: 'Keep the link under 2048 characters',
    },
    {
      block: buildVideoBlock({ url: 'https://vimeo.com/channels/staffpicks' }),
      message: 'Use a YouTube or Vimeo link',
    },
    {
      block: buildVideoBlock({ caption: 'c'.repeat(MAX_CAPTION_LENGTH + 1) }),
      message: 'Keep the caption under 200 characters',
    },
  ])('says "$message" for a $block.type block that breaks the rule', ({
    block, message
  }) => {
    expect(contentBlockProblem(block)).toBe(message);
  });

  it('measures a heading after trimming its surrounding spaces', () => {
    const block = buildHeadingBlock({ text: `  ${'h'.repeat(MAX_HEADING_LENGTH)}  ` });

    expect(contentBlockProblem(block)).toBeNull();
  });

  it('reports the link before the description when both are missing', () => {
    const block = buildImageBlock({
      url: '',
      alt: '',
    });

    expect(contentBlockProblem(block)).toBe('Add the image link');
  });
});

describe('contentBlockIssue', () => {
  it.each([
    {
      block: buildHeadingBlock({ text: '' }),
      field: 'text',
    },
    {
      block: buildTextBlock({ markdown: '' }),
      field: 'markdown',
    },
    {
      block: buildImageBlock({ alt: '' }),
      field: 'alt',
    },
    {
      block: buildVideoBlock({ url: 'https://example.com/clip.mp4' }),
      field: 'url',
    },
    {
      block: buildVideoBlock({ caption: 'c'.repeat(MAX_CAPTION_LENGTH + 1) }),
      field: 'caption',
    },
  ])('names the $field field of a $block.type block', ({
    block, field
  }) => {
    expect(contentBlockIssue(block)?.field).toBe(field);
  });
});

describe('contentBlockPayload', () => {
  it('trims the heading text and keeps its level', () => {
    expect(contentBlockPayload(buildHeadingBlock({
      text: '  Results  ',
      level: 3,
    }))).toStrictEqual({
      type: 'heading',
      text: 'Results',
      level: 3,
    });
  });

  it('trims the markdown of a text block', () => {
    expect(contentBlockPayload(buildTextBlock({ markdown: '\n**Bold** claim\n\n' }))).toStrictEqual({
      type: 'text',
      markdown: '**Bold** claim',
    });
  });

  it('trims the link, description and caption of an image', () => {
    expect(contentBlockPayload(buildImageBlock({
      url: ' https://example.com/logo.png ',
      alt: ' Logo ',
      caption: ' Our mark ',
    }))).toStrictEqual({
      type: 'image',
      url: 'https://example.com/logo.png',
      alt: 'Logo',
      caption: 'Our mark',
    });
  });

  it('leaves out an image caption that is blank', () => {
    expect(contentBlockPayload(buildImageBlock({ caption: '   ' }))).toStrictEqual({
      type: 'image',
      url: 'https://cdn.example.com/brand/hero.jpg',
      alt: 'The hotel terrace at sunset',
    });
  });

  it('leaves out an empty video caption and trims the link', () => {
    expect(contentBlockPayload(buildVideoBlock({
      url: ' https://youtu.be/dQw4w9WgXcQ ',
      caption: '',
    }))).toStrictEqual({
      type: 'video',
      url: 'https://youtu.be/dQw4w9WgXcQ',
    });
  });

  it('drops keys the server does not accept', () => {
    const withClientKey = {
      ...buildHeadingBlock(),
      clientKey: 'block-1',
    };

    expect(contentBlockPayload(withClientKey)).toStrictEqual(buildHeadingBlock());
  });
});
