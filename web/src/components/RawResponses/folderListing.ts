import type { S3Item } from '../../types';

/** A run-day folder name (`2026-10-26`), as the workflow writes them under the bucket root. */
const DAY_NAME = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Run days shown before "Show all": the latest ten. */
const DAY_LIMIT = 10;
/** Entries shown before "Show all" in any other folder. */
const ENTRY_LIMIT = 50;

/** Midnight UTC of a run-day folder name, or null for any other name. */
function dayOf(name: string): Date | null {
  const match = DAY_NAME.exec(name);
  if (match === null) return null;
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return isNaN(day.getTime()) ? null : day;
}

export const isDayFolder = (entry: S3Item): boolean => entry.type === 'folder' && dayOf(entry.name) !== null;

/** `Mon 26 Oct 2026` for a run-day folder name, null for any other name. */
export function formatDayName(name: string): string | null {
  const day = dayOf(name);
  if (day === null) return null;
  const part = (options: Intl.DateTimeFormatOptions) => day.toLocaleDateString('en-GB', {
    ...options,
    timeZone: 'UTC',
  });
  return `${part({ weekday: 'short' })} ${part({ day: 'numeric' })} ${part({ month: 'short' })} ${part({ year: 'numeric' })}`;
}

const monthOf = (entry: S3Item): string | null => {
  const day = isDayFolder(entry) ? dayOf(entry.name) : null;
  return day === null ? null : day.toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

/**
 * Folders, then files, in the order to show them. The API lists both newest
 * first, which suits run days and timestamped files; keyword, provider and
 * persona folders read better A to Z, so a fully loaded folder without run
 * days gets its folders sorted by name.
 */
export function orderEntries(folders: S3Item[], files: S3Item[], complete: boolean): S3Item[] {
  const byName = complete && !folders.some(isDayFolder);
  const ordered = byName ? [...folders].sort((left, right) => left.name.localeCompare(right.name)) : folders;
  return [...ordered, ...files];
}

/** How many entries show before "Show all": fewer for a list of run days. */
export const entryLimit = (entries: S3Item[]): number => (entries.length > 0 && isDayFolder(entries[0]) ? DAY_LIMIT : ENTRY_LIMIT);

/** The entries whose name (or readable day) holds `query`, ignoring case. */
export function filterEntries(entries: S3Item[], query: string): S3Item[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return entries;
  return entries.filter((entry) => `${entry.name} ${formatDayName(entry.name) ?? ''}`.toLowerCase().includes(needle));
}

export interface EntryGroup {
  /** `October 2026` for a month of run days; null for entries that are not run days. */
  label: string | null;
  entries: S3Item[];
}

/** Consecutive entries split by the month of their run day; other entries stay in unlabelled groups. */
export function groupByMonth(entries: S3Item[]): EntryGroup[] {
  const groups: EntryGroup[] = [];
  for (const entry of entries) {
    const label = monthOf(entry);
    const last = groups.length > 0 ? groups[groups.length - 1] : undefined;
    if (last?.label === label) {
      last.entries.push(entry);
    } else {
      groups.push({
        label,
        entries: [entry],
      });
    }
  }
  return groups;
}
