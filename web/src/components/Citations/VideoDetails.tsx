import type { CrawledContent } from '../../types';
import { safeHref } from '../../infrastructure';
import { isHttpsImageUrl } from '../Reports/customReport/content/mediaLinks';

/** Whether a crawl is of a YouTube video (`content_type`, or oEmbed as the source of its details). */
export function isVideoCrawl(citation: CrawledContent): boolean {
  return citation.content_type === 'video' || citation.provider === 'youtube';
}

/**
 * The thumbnail and channel of a cited YouTube video, from its oEmbed details.
 *
 * Both links come from YouTube through the crawler, so neither is trusted: the
 * thumbnail is shown only when it is an https image link, and the channel link
 * goes through `safeHref` (plain text when it is not http(s)).
 */
export const VideoDetails = ({ citation }: { readonly citation: CrawledContent }) => {
  const thumbnail = citation.thumbnail_url ?? '';
  const channel = citation.author_name ?? '';
  const showThumbnail = isHttpsImageUrl(thumbnail);
  if (!showThumbnail && channel === '') return null;

  return (
    <div className="flex flex-col sm:flex-row gap-4 bg-gray-50 border border-gray-200 rounded-lg p-4">
      {showThumbnail && (
        <img
          src={thumbnail}
          alt={`Thumbnail of the YouTube video ${citation.title}`}
          className="w-full sm:w-60 rounded border border-gray-200 object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      )}
      <div className="text-sm">
        <h3 className="font-semibold text-gray-900 mb-1">YouTube video</h3>
        {channel !== '' && (
          <p className="text-gray-700">
            Channel:{' '}
            <a
              href={safeHref(citation.author_url ?? '')}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              {channel}
            </a>
          </p>
        )}
      </div>
    </div>
  );
};
