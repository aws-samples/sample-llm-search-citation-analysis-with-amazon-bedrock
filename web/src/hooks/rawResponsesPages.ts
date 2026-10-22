import type {
  S3BrowseResponse, S3Item
} from '../types';

const byNameNewestFirst = (left: S3Item, right: S3Item): number => {
  if (left.name === right.name) return 0;
  return left.name < right.name ? 1 : -1;
};

/**
 * One listing from a folder's loaded pages: entries of both, newest first by
 * name (date folders and timestamped files), the counts of what is loaded,
 * and the token of the page after `next`.
 */
export function mergeBrowsePages(current: S3BrowseResponse, next: S3BrowseResponse): S3BrowseResponse {
  const folders = [...current.folders, ...next.folders].sort(byNameNewestFirst);
  const files = [...current.files, ...next.files].sort(byNameNewestFirst);
  return {
    ...next,
    folders,
    files,
    total_folders: folders.length,
    total_files: files.length,
  };
}
