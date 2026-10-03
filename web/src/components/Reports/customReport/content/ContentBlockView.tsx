import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { safeHref } from '../../../../infrastructure';
import {
  isHttpsImageUrl, videoEmbedUrl
} from './mediaLinks';
import type {
  ContentBlock, HeadingBlock, ImageBlock, VideoBlock
} from './contentBlocks';

const NEW_TAB_LINK = {
  target: '_blank',
  rel: 'noopener noreferrer',
} as const;

const LINK_CLASS = 'text-blue-700 underline break-all';
const CAPTION_CLASS = 'mt-2 text-xs text-gray-500';

/**
 * Markdown links open in a new tab. Raw HTML is never rendered: without
 * rehype-raw, react-markdown turns it into text, and its default URL
 * transform drops `javascript:` and other unsafe links.
 */
const MARKDOWN_COMPONENTS: Components = {
  a: ({
    href, title, children
  }) => (
    <a href={href} title={title} {...NEW_TAB_LINK}>{children}</a>
  ),
};

function trimmedCaption(caption: string | undefined): string {
  return caption?.trim() ?? '';
}

function HeadingView({ block }: { readonly block: HeadingBlock }) {
  if (block.level === 2) {
    return <h2 className="break-after-avoid text-base font-semibold text-gray-900">{block.text}</h2>;
  }
  return <h3 className="break-after-avoid text-sm font-semibold text-gray-700">{block.text}</h3>;
}

function MarkdownView({ markdown }: { readonly markdown: string }) {
  return (
    <div className="prose-markdown text-sm text-gray-700">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{markdown}</ReactMarkdown>
    </div>
  );
}

function ImageView({ block }: { readonly block: ImageBlock }) {
  const caption = trimmedCaption(block.caption);
  if (!isHttpsImageUrl(block.url)) {
    return <p className="text-sm text-gray-500">This image link cannot be shown.</p>;
  }
  return (
    <figure className="avoid-break-inside">
      <img
        src={block.url.trim()}
        alt={block.alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="h-auto max-w-full rounded-lg border border-gray-200 dark:brightness-90 dark:contrast-95"
      />
      {caption !== '' && <figcaption className={CAPTION_CLASS}>{caption}</figcaption>}
    </figure>
  );
}

function UnembeddableVideo({
  url, caption
}: {
  readonly url: string;
  readonly caption: string;
}) {
  return (
    <div className="avoid-break-inside text-sm text-gray-600">
      <p>
        This video link cannot be embedded.{' '}
        <a href={safeHref(url)} className={LINK_CLASS} {...NEW_TAB_LINK}>{url}</a>
      </p>
      {caption !== '' && <p className={CAPTION_CLASS}>{caption}</p>}
    </div>
  );
}

/**
 * The player is screen-only; on paper the caption stays and a paragraph that
 * is hidden on screen gives the link instead.
 */
function VideoView({ block }: { readonly block: VideoBlock }) {
  const url = block.url.trim();
  const caption = trimmedCaption(block.caption);
  const embedUrl = videoEmbedUrl(url);
  if (embedUrl === null) return <UnembeddableVideo url={url} caption={caption} />;
  return (
    <figure className="avoid-break-inside">
      <div className="print-hidden relative aspect-video w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
        <iframe
          src={embedUrl}
          title={caption === '' ? 'Embedded video' : caption}
          allow="encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
          className="absolute inset-0 h-full w-full"
        />
      </div>
      <figcaption className={CAPTION_CLASS}>
        {caption !== '' && <p>{caption}</p>}
        <p hidden className="print-reveal">
          Watch the video: <a href={url} className={LINK_CLASS} {...NEW_TAB_LINK}>{url}</a>
        </p>
      </figcaption>
    </figure>
  );
}

/** One content block as it appears in a custom report, on screen and on paper. */
export function ContentBlockView({ block }: { readonly block: ContentBlock }) {
  switch (block.type) {
    case 'heading': return <HeadingView block={block} />;
    case 'text': return <MarkdownView markdown={block.markdown} />;
    case 'image': return <ImageView block={block} />;
    case 'video': return <VideoView block={block} />;
  }
}
