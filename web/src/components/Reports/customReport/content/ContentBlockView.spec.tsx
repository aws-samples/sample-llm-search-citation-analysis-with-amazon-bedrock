import {
  describe, expect, it
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { ContentBlockView } from './ContentBlockView';
import {
  buildHeadingBlock, buildImageBlock, buildTextBlock, buildVideoBlock
} from '../customReport-fixtures';

const WATCH_LINK = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

describe('ContentBlockView heading', () => {
  it('renders a large heading as a level-2 heading', () => {
    render(<ContentBlockView block={buildHeadingBlock({ text: 'Highlights' })} />);

    expect(screen.getByRole('heading', {
      level: 2,
      name: 'Highlights',
    })).toBeInTheDocument();
  });

  it('renders a small heading as a level-3 heading', () => {
    render(<ContentBlockView block={buildHeadingBlock({
      text: 'Details',
      level: 3,
    })} />);

    expect(screen.getByRole('heading', {
      level: 3,
      name: 'Details',
    })).toBeInTheDocument();
  });
});

describe('ContentBlockView text', () => {
  it('renders markdown bold as strong text', () => {
    const { container } = render(<ContentBlockView block={buildTextBlock({ markdown: 'A **bold** claim' })} />);

    expect(container.querySelector('strong')).toHaveTextContent('bold');
  });

  it('opens markdown links in a new tab without passing the opener or referrer', () => {
    render(<ContentBlockView block={buildTextBlock({ markdown: 'See [our site](https://example.com/about).' })} />);
    const link = screen.getByRole('link', { name: 'our site' });

    expect(link).toHaveAttribute('href', 'https://example.com/about');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('removes the target of a javascript markdown link', () => {
    render(<ContentBlockView block={buildTextBlock({ markdown: '[click me](javascript:alert(1))' })} />);

    expect(screen.getByText('click me')).toHaveAttribute('href', '');
  });

  it('renders a gfm table', () => {
    render(<ContentBlockView block={buildTextBlock({ markdown: '| Engine | Mentions |\n| --- | --- |\n| Gemini | 4 |' })} />);

    expect(screen.getByRole('cell', { name: 'Gemini' })).toBeInTheDocument();
  });

  it('shows a script tag in the markdown as text without running it', () => {
    const { container } = render(<ContentBlockView block={buildTextBlock({ markdown: 'Before <script>alert(1)</script> after' })} />);

    expect(container.querySelector('script')).toBeNull();
    expect(container).toHaveTextContent('Before <script>alert(1)</script> after');
  });

  it('shows an image tag with an error handler in the markdown as text', () => {
    const { container } = render(<ContentBlockView block={buildTextBlock({ markdown: 'Look <img src=x onerror=alert(1)> here' })} />);

    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('Look <img src=x onerror=alert(1)> here');
  });
});

describe('ContentBlockView image', () => {
  it('describes the image with its alt text and loads it lazily without a referrer', () => {
    render(<ContentBlockView block={buildImageBlock({ url: ' https://example.com/logo.png ' })} />);
    const image = screen.getByRole('img', { name: 'The hotel terrace at sunset' });

    expect(image).toHaveAttribute('src', 'https://example.com/logo.png');
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('captions the figure', () => {
    render(<ContentBlockView block={buildImageBlock()} />);

    expect(screen.getByText('Hero image of the spring campaign').tagName).toBe('FIGCAPTION');
  });

  it('adds no caption when the caption is blank', () => {
    const { container } = render(<ContentBlockView block={buildImageBlock({ caption: '  ' })} />);

    expect(container.querySelector('figcaption')).toBeNull();
  });

  it('shows a note instead of an image whose link is not https', () => {
    render(<ContentBlockView block={buildImageBlock({ url: 'http://example.com/logo.png' })} />);

    expect([screen.queryByRole('img'), screen.getByText('This image link cannot be shown.').tagName]).toStrictEqual([null, 'P']);
  });
});

describe('ContentBlockView video', () => {
  it('embeds the privacy-enhanced player titled by the caption', () => {
    render(<ContentBlockView block={buildVideoBlock({ url: WATCH_LINK })} />);

    expect(screen.getByTitle('Launch walkthrough')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });

  it('titles the player "Embedded video" when there is no caption', () => {
    render(<ContentBlockView block={buildVideoBlock({ caption: undefined })} />);

    expect(screen.getByTitle('Embedded video').tagName).toBe('IFRAME');
  });

  it('limits what the player may do and loads it lazily', () => {
    render(<ContentBlockView block={buildVideoBlock()} />);
    const player = screen.getByTitle('Launch walkthrough');

    expect(player).toHaveAttribute('allow', 'encrypted-media; picture-in-picture; fullscreen');
    expect(player).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    expect(player).toHaveAttribute('loading', 'lazy');
    expect(player).toHaveAttribute('allowfullscreen');
  });

  it('keeps the player off paper', () => {
    render(<ContentBlockView block={buildVideoBlock()} />);

    expect(screen.getByTitle('Launch walkthrough').parentElement).toHaveClass('print-hidden');
  });

  it('gives the link in a paragraph hidden on screen and revealed on paper', () => {
    render(<ContentBlockView block={buildVideoBlock({ url: WATCH_LINK })} />);
    const paragraph = screen.getByRole('link', {
      hidden: true,
      name: WATCH_LINK,
    }).closest('p');

    expect(paragraph).toHaveAttribute('hidden');
    expect(paragraph).toHaveClass('print-reveal');
  });

  it('shows the caption under the player', () => {
    render(<ContentBlockView block={buildVideoBlock()} />);

    expect(screen.getByText('Launch walkthrough').parentElement?.tagName).toBe('FIGCAPTION');
  });

  it('says a link it cannot embed cannot be embedded and links to it', () => {
    render(<ContentBlockView block={buildVideoBlock({ url: 'https://vimeo.com/channels/staffpicks' })} />);

    expect(screen.getByText('This video link cannot be embedded.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://vimeo.com/channels/staffpicks' })).toHaveAttribute('target', '_blank');
  });

  it('shows an unsafe video link as text without a target', () => {
    render(<ContentBlockView block={buildVideoBlock({ url: 'javascript:alert(1)' })} />);

    expect(screen.getByText('javascript:alert(1)')).not.toHaveAttribute('href');
  });
});
