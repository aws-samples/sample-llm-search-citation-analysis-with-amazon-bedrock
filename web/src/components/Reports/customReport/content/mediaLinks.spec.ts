import {
  describe, expect, it
} from 'vitest';
import blockFixtures from '../../../../../../test-fixtures/custom-report-blocks.json';
import {
  MAX_MEDIA_URL_LENGTH, isHttpsImageUrl, videoEmbedUrl
} from './mediaLinks';

const IMAGE_URL_PREFIX = 'https://example.com/';

describe('videoEmbedUrl', () => {
  it.each(blockFixtures.videoUrls)('returns $embed for a $description', ({
    url, embed
  }) => {
    expect(videoEmbedUrl(url)).toBe(embed);
  });

  it.each([
    {
      description: 'an explicit default port',
      url: 'https://www.youtube.com:443/watch?v=dQw4w9WgXcQ',
    },
    {
      description: 'an explicit other port',
      url: 'https://vimeo.com:8443/76979871',
    },
    {
      description: 'a Vimeo id longer than 12 digits',
      url: 'https://vimeo.com/1234567890123',
    },
    {
      description: 'a YouTube id with a character outside the id alphabet',
      url: 'https://youtu.be/dQw4w9WgXc!',
    },
    {
      description: 'an empty credentials prefix',
      url: 'https://@youtu.be/dQw4w9WgXcQ',
    },
    {
      description: 'whitespace inside the link',
      url: 'https://youtu.be/dQw4w9 WgXcQ',
    },
    {
      description: 'a third slash after the scheme',
      url: 'https:///youtu.be/dQw4w9WgXcQ',
    },
    {
      description: 'a backslash for a slash',
      url: 'https://youtu.be\\dQw4w9WgXcQ',
    },
    {
      description: 'a link longer than the limit',
      url: `https://youtu.be/dQw4w9WgXcQ?pad=${'a'.repeat(MAX_MEDIA_URL_LENGTH)}`,
    },
    {
      description: 'an empty port',
      url: 'https://youtu.be:/dQw4w9WgXcQ',
    },
    {
      description: 'a dot segment the browser would resolve',
      url: 'https://youtu.be/./dQw4w9WgXcQ',
    },
    {
      description: 'a trailing slash after the id',
      url: 'https://www.youtube.com/embed/dQw4w9WgXcQ/',
    },
  ])('returns null for $description', ({ url }) => {
    expect(videoEmbedUrl(url)).toBeNull();
  });

  it('reads the scheme and host case-insensitively', () => {
    expect(videoEmbedUrl('HTTPS://WWW.YouTube.com/watch?v=dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });

  it('takes the first non-blank video parameter of a watch link', () => {
    expect(videoEmbedUrl('https://www.youtube.com/watch?v=&v=dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });

  it('embeds a 12-digit Vimeo id', () => {
    expect(videoEmbedUrl('https://vimeo.com/123456789012')).toBe('https://player.vimeo.com/video/123456789012?dnt=1');
  });
});

describe('isHttpsImageUrl', () => {
  it.each(blockFixtures.imageUrls)('returns $valid for a $description', ({
    url, valid
  }) => {
    expect(isHttpsImageUrl(url)).toBe(valid);
  });

  it('accepts a link of exactly the length limit', () => {
    const url = `${IMAGE_URL_PREFIX}${'a'.repeat(MAX_MEDIA_URL_LENGTH - IMAGE_URL_PREFIX.length)}`;

    expect(isHttpsImageUrl(url)).toBe(true);
  });

  it('rejects a link one character over the length limit', () => {
    const url = `${IMAGE_URL_PREFIX}${'a'.repeat(MAX_MEDIA_URL_LENGTH - IMAGE_URL_PREFIX.length + 1)}`;

    expect(isHttpsImageUrl(url)).toBe(false);
  });

  it('measures the length after trimming surrounding whitespace', () => {
    const url = `  ${IMAGE_URL_PREFIX}${'a'.repeat(MAX_MEDIA_URL_LENGTH - IMAGE_URL_PREFIX.length)}  `;

    expect(isHttpsImageUrl(url)).toBe(true);
  });

  it.each([
    {
      description: 'an empty credentials prefix',
      url: 'https://@example.com/logo.png',
      valid: false,
    },
    {
      description: 'port 0',
      url: 'https://example.com:0/logo.png',
      valid: false,
    },
    {
      description: 'an explicit https port',
      url: 'https://example.com:443/logo.png',
      valid: true,
    },
    {
      description: 'a control character inside',
      url: 'https://example.com/lo\u0007go.png',
      valid: false,
    },
    {
      description: 'a non-breaking space inside',
      url: 'https://example.com/lo\u00a0go.png',
      valid: false,
    },
    {
      description: 'a scheme without slashes',
      url: 'https:example.com/logo.png',
      valid: false,
    },
  ])('returns $valid for $description', ({
    url, valid
  }) => {
    expect(isHttpsImageUrl(url)).toBe(valid);
  });
});
