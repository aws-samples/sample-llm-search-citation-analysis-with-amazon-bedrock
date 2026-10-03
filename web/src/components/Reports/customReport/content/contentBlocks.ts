/**
 * Content blocks: the blocks of a custom report that carry their own content
 * (a heading, markdown text, an image or a video), unlike data blocks, which
 * only name an existing report section.
 *
 * `contentBlockProblem` mirrors the server's check in
 * `lambda/api/manage-custom-reports.py`, which strips every string before it
 * measures it and rejects any key it does not know; `contentBlockPayload`
 * builds exactly the block the server accepts.
 */
import type { ReportBlock } from '../../../../api/customReports';
import {
  MAX_MEDIA_URL_LENGTH, isHttpsImageUrl, videoEmbedUrl
} from './mediaLinks';

export const CONTENT_BLOCK_TYPES = ['heading', 'text', 'image', 'video'] as const;

export type ContentBlockType = typeof CONTENT_BLOCK_TYPES[number];

export const MAX_HEADING_LENGTH = 120;
export const MAX_TEXT_LENGTH = 5000;
export const MAX_ALT_LENGTH = 200;
export const MAX_CAPTION_LENGTH = 200;

/** 2 renders a large heading (`<h2>`), 3 a small one (`<h3>`). */
type HeadingLevel = 2 | 3;

export type HeadingBlock = {
  readonly type: 'heading';
  readonly text: string;
  readonly level: HeadingLevel;
};

export type TextBlock = {
  readonly type: 'text';
  readonly markdown: string;
};

export type ImageBlock = {
  readonly type: 'image';
  readonly url: string;
  readonly alt: string;
  readonly caption?: string;
};

export type VideoBlock = {
  readonly type: 'video';
  readonly url: string;
  readonly caption?: string;
};

export type ContentBlock = HeadingBlock | TextBlock | ImageBlock | VideoBlock;

/** The block field a problem is about, so an editor can mark that field. */
export type ContentBlockField = 'text' | 'markdown' | 'url' | 'alt' | 'caption';

export interface ContentBlockIssue {
  readonly field: ContentBlockField;
  readonly message: string;
}

interface LengthRule {
  readonly field: ContentBlockField;
  readonly value: string | undefined;
  readonly max: number;
  /** Message for a blank value; a rule without one treats the field as optional. */
  readonly missing?: string;
  readonly tooLong: string;
}

const isOptionalString = (value: unknown): boolean => value === undefined || typeof value === 'string';

const BLOCK_SHAPES: Readonly<Record<ContentBlockType, (block: ReportBlock) => boolean>> = {
  heading: (block) => typeof block.text === 'string' && (block.level === 2 || block.level === 3),
  text: (block) => typeof block.markdown === 'string',
  image: (block) => typeof block.url === 'string' && typeof block.alt === 'string' && isOptionalString(block.caption),
  video: (block) => typeof block.url === 'string' && isOptionalString(block.caption),
};

function isContentBlockType(type: string): type is ContentBlockType {
  return CONTENT_BLOCK_TYPES.some((contentType) => contentType === type);
}

/** Whether `block` is a content block with well-formed fields. */
export function isContentBlock(block: ReportBlock): block is ContentBlock {
  return isContentBlockType(block.type) && BLOCK_SHAPES[block.type](block);
}

/** An empty block of `type`, ready for the editor; a heading starts large. */
export function newContentBlock(type: ContentBlockType): ContentBlock {
  switch (type) {
    case 'heading': return {
      type,
      text: '',
      level: 2,
    };
    case 'text': return {
      type,
      markdown: '',
    };
    case 'image': return {
      type,
      url: '',
      alt: '',
      caption: '',
    };
    case 'video': return {
      type,
      url: '',
      caption: '',
    };
  }
}

function lengthIssue({
  field, value, max, missing, tooLong
}: LengthRule): ContentBlockIssue | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length === 0) {
    return missing === undefined ? null : {
      field,
      message: missing,
    };
  }
  return trimmed.length > max ? {
    field,
    message: tooLong,
  } : null;
}

function linkIssue(url: string, missing: string, accepted: boolean, rejected: string): ContentBlockIssue | null {
  return lengthIssue({
    field: 'url',
    value: url,
    max: MAX_MEDIA_URL_LENGTH,
    missing,
    tooLong: `Keep the link under ${MAX_MEDIA_URL_LENGTH} characters`,
  }) ?? (accepted ? null : {
    field: 'url',
    message: rejected,
  });
}

function captionIssue(caption: string | undefined): ContentBlockIssue | null {
  return lengthIssue({
    field: 'caption',
    value: caption,
    max: MAX_CAPTION_LENGTH,
    tooLong: `Keep the caption under ${MAX_CAPTION_LENGTH} characters`,
  });
}

function imageIssue(block: ImageBlock): ContentBlockIssue | null {
  return linkIssue(block.url, 'Add the image link', isHttpsImageUrl(block.url), 'Use an https image link')
    ?? lengthIssue({
      field: 'alt',
      value: block.alt,
      max: MAX_ALT_LENGTH,
      missing: 'Describe the image for people who cannot see it',
      tooLong: `Keep the description under ${MAX_ALT_LENGTH} characters`,
    })
    ?? captionIssue(block.caption);
}

function videoIssue(block: VideoBlock): ContentBlockIssue | null {
  return linkIssue(block.url, 'Add the video link', videoEmbedUrl(block.url) !== null, 'Use a YouTube or Vimeo link')
    ?? captionIssue(block.caption);
}

/** The first thing the server would reject in `block`, with the field it is about; `null` when it would save. */
export function contentBlockIssue(block: ContentBlock): ContentBlockIssue | null {
  switch (block.type) {
    case 'heading': return lengthIssue({
      field: 'text',
      value: block.text,
      max: MAX_HEADING_LENGTH,
      missing: 'Add the heading text',
      tooLong: `Keep the heading under ${MAX_HEADING_LENGTH} characters`,
    });
    case 'text': return lengthIssue({
      field: 'markdown',
      value: block.markdown,
      max: MAX_TEXT_LENGTH,
      missing: 'Add some text',
      tooLong: `Keep the text under ${MAX_TEXT_LENGTH} characters`,
    });
    case 'image': return imageIssue(block);
    case 'video': return videoIssue(block);
  }
}

/** A sentence saying what to fix in `block` before it can be saved; `null` when it would save. */
export function contentBlockProblem(block: ContentBlock): string | null {
  return contentBlockIssue(block)?.message ?? null;
}

function captionField(caption: string | undefined): { readonly caption?: string } {
  const trimmed = caption?.trim() ?? '';
  return trimmed === '' ? {} : { caption: trimmed };
}

/** The block to send: its own fields only, strings trimmed, an empty caption left out. */
export function contentBlockPayload(block: ContentBlock): ContentBlock {
  switch (block.type) {
    case 'heading': return {
      type: 'heading',
      text: block.text.trim(),
      level: block.level,
    };
    case 'text': return {
      type: 'text',
      markdown: block.markdown.trim(),
    };
    case 'image': return {
      type: 'image',
      url: block.url.trim(),
      alt: block.alt.trim(),
      ...captionField(block.caption),
    };
    case 'video': return {
      type: 'video',
      url: block.url.trim(),
      ...captionField(block.caption),
    };
  }
}
