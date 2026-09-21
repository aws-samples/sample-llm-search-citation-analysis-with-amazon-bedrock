import {
  describe, expect, it
} from 'vitest';
import {
  screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildKeyword } from '../../api/keywordGroups-fixtures';
import {
  UNGROUPED_SECTION_ID, buildSections
} from './KeywordScopePicker';
import {
  corunaGroupFixture,
  keywordScopePickerKeywords,
  marinoGroupFixture,
  renderKeywordScopePicker,
} from './KeywordScopePicker-fixtures';

describe('buildSections', () => {
  it('lists a keyword under every group it belongs to and the rest under Ungrouped', () => {
    const sections = buildSections(
      keywordScopePickerKeywords,
      [corunaGroupFixture, marinoGroupFixture]
    );

    expect(sections.map((section) => [section.id, section.keywords.map((keyword) => keyword.id)])).toStrictEqual([
      ['coruna', ['k1', 'k3']],
      ['marino', ['k2', 'k3']],
      [UNGROUPED_SECTION_ID, ['k4']],
    ]);
  });

  it('labels the only section "All keywords" when there are no groups', () => {
    const sections = buildSections(keywordScopePickerKeywords, []);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.name).toBe('All keywords');
  });

  it('treats membership in a deleted group as ungrouped', () => {
    const sections = buildSections([buildKeyword({
      id: 'k9',
      group_ids: ['gone']
    })], [corunaGroupFixture]);

    expect(sections.map((section) => section.id)).toStrictEqual([UNGROUPED_SECTION_ID]);
  });
});

describe('KeywordScopePicker', () => {
  it('associates search with the supplied page-specific identity', () => {
    renderKeywordScopePicker();

    const search = screen.getByLabelText<HTMLInputElement>('Search keywords');

    expect({
      id: search.id,
      labelFor: search.labels?.[0]?.htmlFor,
      name: search.name,
    }).toStrictEqual({
      id: 'test-keyword-scope-search',
      labelFor: 'test-keyword-scope-search',
      name: 'test-keyword-scope-search',
    });
  });

  it('gives section checkboxes stable plural names and exact values', () => {
    renderKeywordScopePicker();

    const section = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select all in Hotel Coruña' });

    expect({
      id: section.id,
      labelFor: section.labels?.[0]?.htmlFor,
      name: section.name,
      value: section.value,
    }).toStrictEqual({
      id: 'test-keyword-scope-section-coruna',
      labelFor: 'test-keyword-scope-section-coruna',
      name: 'test-keyword-scope-section-ids',
      value: 'coruna',
    });
  });

  it('gives repeated keyword checkboxes unique ids with one plural name', () => {
    renderKeywordScopePicker();

    const repeatedKeywords = screen.getAllByRole<HTMLInputElement>('checkbox', { name: 'galicia hotels' });

    expect(repeatedKeywords.map((keyword) => ({
      id: keyword.id,
      labelFor: keyword.labels?.[0]?.htmlFor,
      name: keyword.name,
      value: keyword.value,
    }))).toStrictEqual([
      {
        id: 'test-keyword-scope-section-coruna-keyword-k3',
        labelFor: 'test-keyword-scope-section-coruna-keyword-k3',
        name: 'test-keyword-ids',
        value: 'k3',
      },
      {
        id: 'test-keyword-scope-section-marino-keyword-k3',
        labelFor: 'test-keyword-scope-section-marino-keyword-k3',
        name: 'test-keyword-ids',
        value: 'k3',
      },
    ]);
  });

  it.each([
    {
      title: 'selects every keyword of a group when its header checkbox is ticked',
      selectedIds: [],
      expectedIds: ['k1', 'k3'],
    },
    {
      title: 'deselects the whole group when every member was already selected',
      selectedIds: ['k1', 'k3', 'k2'],
      expectedIds: ['k2'],
    },
  ])('$title', async ({
    selectedIds, expectedIds
  }) => {
    const pickerProps = renderKeywordScopePicker({ selectedIds });

    await userEvent.setup().click(
      screen.getByRole('checkbox', { name: 'Select all in Hotel Coruña' })
    );

    expect(pickerProps.onChange).toHaveBeenCalledWith(expectedIds);
  });

  it('marks a partially selected group as indeterminate', () => {
    renderKeywordScopePicker({ selectedIds: ['k1'] });

    const header = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select all in Hotel Coruña' });

    expect(header.indeterminate).toBe(true);
    expect(header.checked).toBe(false);
  });

  it('toggles a single keyword by id even when it is listed under two groups', async () => {
    const pickerProps = renderKeywordScopePicker();
    const marinoSection = screen.getByRole('region', { name: 'Hotel Gran Marino' });

    await userEvent.setup().click(within(marinoSection).getByLabelText('galicia hotels'));

    expect(pickerProps.onChange).toHaveBeenCalledWith(['k3']);
  });

  it('filters keywords by the search box and hides empty groups', async () => {
    renderKeywordScopePicker();

    await userEvent.setup().type(screen.getByRole('searchbox', { name: 'Search keywords' }), 'beach');

    expect(screen.getByRole('region', { name: 'Hotel Gran Marino' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Hotel Coruña' })).not.toBeInTheDocument();
  });

  it('shows the selection count and offers select all', async () => {
    const pickerProps = renderKeywordScopePicker({ selectedIds: ['k1'] });

    expect(screen.getByText('1 of 4 selected')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Select all' }));
    expect(pickerProps.onChange).toHaveBeenCalledWith(['k1', 'k2', 'k3', 'k4']);
  });
});
