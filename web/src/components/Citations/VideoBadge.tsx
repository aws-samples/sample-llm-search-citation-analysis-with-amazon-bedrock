import { StrokeIcon } from '../ui/StrokeIcon';
import { PLAY_PATHS } from '../ui/iconPaths';

/** The "Video" tag of a cited YouTube video (Citations tab, Citation Gaps). */
export function VideoBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 rounded"
      title="YouTube video"
    >
      <StrokeIcon className="w-3 h-3" paths={PLAY_PATHS} aria-hidden="true" />
      Video
      <span className="sr-only"> (YouTube)</span>
    </span>
  );
}
