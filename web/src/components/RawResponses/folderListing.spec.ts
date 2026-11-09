import {
  describe, it, expect
} from 'vitest';
import {
  entryLimit, filterEntries, formatDayName, groupByMonth, orderEntries
} from './folderListing';
import {
  buildDayFolders, buildFolder
} from './FolderFileList-fixtures';
import { buildFile } from './FileViewer-fixtures';

describe('formatDayName', () => {
  it('reads a run-day folder name as a weekday and date', () => {
    expect(formatDayName('2026-10-26')).toBe('Mon 26 Oct 2026');
  });

  it.each(['best-hotels-in-madrid', '2026-10', '2026-13-45x'])('leaves %s alone', (name) => {
    expect(formatDayName(name)).toBeNull();
  });
});

describe('orderEntries', () => {
  it('sorts the folders of a fully loaded keyword or provider folder A to Z, before the files', () => {
    const file = buildFile();

    const ordered = orderEntries([buildFolder('tavily'), buildFolder('agentcore'), buildFolder('openai')], [file], true);

    expect(ordered.map((entry) => entry.name)).toStrictEqual(['agentcore', 'openai', 'tavily', file.name]);
  });

  it('keeps run days newest first', () => {
    const days = buildDayFolders(3);

    expect(orderEntries([...days], [], true)).toStrictEqual(days);
  });

  it('keeps the API order while more pages remain', () => {
    const folders = [buildFolder('b'), buildFolder('a')];

    expect(orderEntries(folders, [], false)).toStrictEqual(folders);
  });
});

describe('entryLimit', () => {
  it('shows the latest ten run days, and up to fifty other entries', () => {
    expect([entryLimit(buildDayFolders(40)), entryLimit([buildFolder('openai')]), entryLimit([])]).toStrictEqual([10, 50, 50]);
  });
});

describe('filterEntries', () => {
  it('matches the folder name or its readable date, ignoring case', () => {
    const days = buildDayFolders(40);

    expect([filterEntries(days, ' OCT 2026 ').length, filterEntries(days, '2026-10-2').map((day) => day.name)]).toStrictEqual([
      26, ['2026-10-26', '2026-10-25', '2026-10-24', '2026-10-23', '2026-10-22', '2026-10-21', '2026-10-20'],
    ]);
  });
});

describe('groupByMonth', () => {
  it('heads each month of run days and leaves other entries unlabelled', () => {
    const groups = groupByMonth([...buildDayFolders(28), buildFolder('openai')]);

    expect(groups.map((group) => [group.label, group.entries.length])).toStrictEqual([
      ['October 2026', 26], ['September 2026', 2], [null, 1],
    ]);
  });
});
