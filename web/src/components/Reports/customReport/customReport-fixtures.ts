import {
  fireEvent, screen
} from '@testing-library/react';
import type {
  HeadingBlock, ImageBlock, TextBlock, VideoBlock
} from './content/contentBlocks';

/** Types `value` into the field labelled `label`. */
export function changeField(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** A large heading that would save; every field can be overridden. */
export function buildHeadingBlock(overrides: Partial<HeadingBlock> = {}): HeadingBlock {
  return {
    type: 'heading',
    text: 'What changed this quarter',
    level: 2,
    ...overrides,
  };
}

/** A markdown text block that would save; every field can be overridden. */
export function buildTextBlock(overrides: Partial<TextBlock> = {}): TextBlock {
  return {
    type: 'text',
    markdown: 'Mentions rose **after** the launch.',
    ...overrides,
  };
}

/** An https image with a description and a caption; every field can be overridden. */
export function buildImageBlock(overrides: Partial<ImageBlock> = {}): ImageBlock {
  return {
    type: 'image',
    url: 'https://cdn.example.com/brand/hero.jpg',
    alt: 'The hotel terrace at sunset',
    caption: 'Hero image of the spring campaign',
    ...overrides,
  };
}

/** A YouTube video with a caption; every field can be overridden. */
export function buildVideoBlock(overrides: Partial<VideoBlock> = {}): VideoBlock {
  return {
    type: 'video',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    caption: 'Launch walkthrough',
    ...overrides,
  };
}
