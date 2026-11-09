import type { S3Item } from '../../types';

export function buildFolder(name: string, parent = 'raw-responses/'): S3Item {
  return {
    name,
    path: `${parent}${name}/`,
    type: 'folder',
  };
}

/** `count` run-day folders, newest first, one per day back from 26 Oct 2026 (as the API lists the root). */
export function buildDayFolders(count: number): S3Item[] {
  const newest = Date.UTC(2026, 9, 26);
  return Array.from({ length: count }, (_unused, index) => buildFolder(
    new Date(newest - index * 86_400_000).toISOString().slice(0, 10)
  ));
}

/** A folder listing holding only `folders`, all loaded. */
export function buildFolderListing(folders: S3Item[], extra: {
  folder_count?: number;
  truncated?: boolean 
} = {}) {
  return {
    folders,
    files: [] as S3Item[],
    total_folders: folders.length,
    total_files: 0,
    ...extra,
  };
}
