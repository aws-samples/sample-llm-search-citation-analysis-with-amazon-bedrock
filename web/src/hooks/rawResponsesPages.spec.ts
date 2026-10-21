import {
  describe, it, expect
} from 'vitest';
import { mergeBrowsePages } from './rawResponsesPages';
import {
  firstBrowsePage, lastBrowsePage
} from './useRawResponses-fixtures';

describe('mergeBrowsePages', () => {
  it('lists the files of both pages newest first by name', () => {
    const merged = mergeBrowsePages(firstBrowsePage, lastBrowsePage);

    expect(merged.files.map((file) => file.name)).toStrictEqual(['c.json', 'b.json']);
  });

  it('counts the entries of both pages', () => {
    const merged = mergeBrowsePages(firstBrowsePage, lastBrowsePage);

    expect([merged.total_folders, merged.total_files]).toStrictEqual([0, 2]);
  });

  it('keeps the next_token of the later page', () => {
    expect(mergeBrowsePages(lastBrowsePage, firstBrowsePage).next_token).toBe('page-2');
  });
});
