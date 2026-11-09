import {
  describe, expect, it
} from 'vitest';
import type { TabType } from '../../types';
import {
  pageTitle, pageTitleText, type PageTitle
} from './pageTitle';

describe('pageTitle', () => {
  it.each<[TabType, string, PageTitle]>([
    ['citations', '/citations', { title: 'Citations' }],
    ['seo', '/seo', { title: 'SEO' }],
    ['seo', '/seo/backlinks', {
      group: 'SEO',
      title: 'Backlinks',
    }],
    ['seo', '/seo/domain/example.com', {
      group: 'SEO',
      title: 'Domain Overview',
    }],
    ['settings', '/settings', {
      group: 'Settings',
      title: 'Keywords',
    }],
    ['settings', '/settings/ai-assistants', {
      group: 'Settings',
      title: 'AI assistants',
    }],
    ['reports', '/reports', { title: 'Reports' }],
    ['reports', '/reports/benchmark', {
      title: 'Reports',
      ownHeader: true,
    }],
  ])('names the %s page at %s', (tab, pathname, expected) => {
    expect(pageTitle(tab, pathname)).toStrictEqual(expected);
  });

  it.each<[PageTitle, string]>([
    [{ title: 'Reports' }, 'Reports'],
    [{
      group: 'SEO',
      title: 'Backlinks',
    }, 'SEO › Backlinks'],
  ])('writes %o as one line for print', (title, expected) => {
    expect(pageTitleText(title)).toBe(expected);
  });
});
