import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  KeywordScopePicker, buildSections
} from './KeywordScopePicker';
import { buildKeyword } from '../../api/keywordGroups-fixtures';
import {
  buildCappedKeywordScopePickerProps,
  buildGroupScopePickerProps,
  buildKeywordScopePickerProps,
  buildScopedKeywordScopePickerProps,
  buildSelectedCappedKeywordScopePickerProps,
  cappedScopeSelectedIds,
  renderLegacyKeywordScopePicker,
  scopePickerCorunaGroup,
  scopePickerKeywords,
  scopePickerMarinoGroup
} from './KeywordScopePicker-fixtures';

const coruna = scopePickerCorunaGroup;
const marino = scopePickerMarinoGroup;
const keywords = scopePickerKeywords;

describe('buildSections', () => {
  it('lists a keyword under every group it belongs to and the rest under Ungrouped', () => {
    const sections = buildSections(keywords, [coruna, marino]);

    expect(sections.map((section) => [section.id, section.keywords.map((keyword) => keyword.id)])).toStrictEqual([
      ['coruna', ['k1', 'k3']],
      ['marino', ['k2', 'k3']],
      ['__ungrouped__', ['k4']],
    ]);
  });

  it('labels the only section "All keywords" when there are no groups', () => {
    const sections = buildSections(keywords, []);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.name).toBe('All keywords');
  });

  it('treats membership in a deleted group as ungrouped', () => {
    const sections = buildSections([buildKeyword({
      id: 'k9',
      group_ids: ['gone']
    })], [coruna]);

    expect(sections.map((section) => section.id)).toStrictEqual(['__ungrouped__']);
  });
});

describe('KeywordScopePicker', () => {
  it('associates search with the supplied page-specific identity', () => {
    renderLegacyKeywordScopePicker();

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
    renderLegacyKeywordScopePicker();

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
    renderLegacyKeywordScopePicker();

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
    const onChange = vi.fn();
    renderLegacyKeywordScopePicker(selectedIds, { onChange });

    await userEvent.setup().click(
      screen.getByRole('checkbox', { name: 'Select all in Hotel Coruña' })
    );

    expect(onChange).toHaveBeenCalledWith(expectedIds);
  });

  it('marks a partially selected group as indeterminate', () => {
    renderLegacyKeywordScopePicker(['k1']);

    const header = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select all in Hotel Coruña' });

    expect(header.indeterminate).toBe(true);
    expect(header.checked).toBe(false);
  });

  it('toggles a single keyword by id even when it is listed under two groups', async () => {
    const onChange = vi.fn();
    renderLegacyKeywordScopePicker([], { onChange });
    const marinoSection = screen.getByRole('region', { name: 'Hotel Gran Marino' });

    await userEvent.setup().click(within(marinoSection).getByLabelText('galicia hotels'));

    expect(onChange).toHaveBeenCalledWith(['k3']);
  });

  it('filters keywords by the search box and hides empty groups', async () => {
    renderLegacyKeywordScopePicker();

    await userEvent.setup().type(screen.getByRole('searchbox', { name: 'Search keywords' }), 'beach');

    expect(screen.getByRole('region', { name: 'Hotel Gran Marino' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Hotel Coruña' })).not.toBeInTheDocument();
  });

  it('shows the selection count and offers select all', async () => {
    const onChange = vi.fn();
    renderLegacyKeywordScopePicker(['k1'], { onChange });

    expect(screen.getByText('1 of 4 selected')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Select all' }));
    expect(onChange).toHaveBeenCalledWith(['k1', 'k2', 'k3', 'k4']);
  });
});

describe('KeywordScopePicker scoped branch', () => {
  it('emits direct group scope when a group is selected', async () => {
    const onChange = vi.fn();
    render(<KeywordScopePicker {...buildGroupScopePickerProps([], { onChange })} />);

    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Hotel Coruña' }));

    expect(onChange).toHaveBeenCalledWith({
      mode: 'groups',
      group_ids: ['coruna'],
    });
  });

  it('emits both group IDs when uncapped group mode selects a second group', async () => {
    const onChange = vi.fn();
    render(<KeywordScopePicker {...buildGroupScopePickerProps(['coruna'], { onChange })} />);

    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Hotel Gran Marino' }));

    expect(onChange).toHaveBeenCalledWith({
      mode: 'groups',
      group_ids: ['coruna', 'marino'],
    });
  });

  it('disables only unchecked groups when maxGroups is reached', () => {
    render(<KeywordScopePicker {...buildGroupScopePickerProps(['coruna'], { maxGroups: 1 })} />);

    expect(screen.getByRole('checkbox', { name: 'Hotel Coruña' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Hotel Gran Marino' })).toBeDisabled();
  });

  it('emits empty group scope when selected group is removed at maxGroups', async () => {
    const onChange = vi.fn();
    render(<KeywordScopePicker {...buildGroupScopePickerProps(['coruna'], {
      maxGroups: 1,
      onChange,
    })} />);
    const selectedGroup = screen.getByRole('checkbox', { name: 'Hotel Coruña' });

    await userEvent.setup().click(selectedGroup);

    expect(onChange).toHaveBeenLastCalledWith({
      mode: 'groups',
      group_ids: [],
    });
  });

  it('emits input-ordered keyword scope when one keyword is selected', async () => {
    const onChange = vi.fn();
    render(<KeywordScopePicker {...buildKeywordScopePickerProps(['k3'], { onChange })} />);

    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'marino beach' }));

    expect(onChange).toHaveBeenCalledWith({
      mode: 'keywords',
      keyword_ids: ['k2', 'k3'],
    });
  });

  it('emits first 50 keyword IDs when capped global bulk selection is used', async () => {
    const onChange = vi.fn();
    render(<KeywordScopePicker {...buildCappedKeywordScopePickerProps({ onChange })} />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Select first 50' }));

    expect(onChange).toHaveBeenCalledWith({
      mode: 'keywords',
      keyword_ids: cappedScopeSelectedIds,
    });
  });

  it('emits first 50 keyword IDs when capped section bulk selection is used', async () => {
    const onChange = vi.fn();
    render(<KeywordScopePicker {...buildCappedKeywordScopePickerProps({ onChange })} />);

    await userEvent.setup().click(
      screen.getByRole('checkbox', { name: 'Select first 50 in Large group' })
    );

    expect(onChange).toHaveBeenCalledWith({
      mode: 'keywords',
      keyword_ids: cappedScopeSelectedIds,
    });
  });

  it('disables only unchecked keywords when maxKeywords is reached', () => {
    render(<KeywordScopePicker {...buildSelectedCappedKeywordScopePickerProps()} />);

    expect(screen.getByRole('checkbox', { name: 'Capped keyword 1' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Capped keyword 51' })).toBeDisabled();
  });

  it('emits remaining keyword IDs when a selected keyword is removed at maxKeywords', async () => {
    const onChange = vi.fn();
    render(<KeywordScopePicker {...buildSelectedCappedKeywordScopePickerProps({ onChange })} />);

    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Capped keyword 1' }));

    expect(onChange).toHaveBeenCalledWith({
      mode: 'keywords',
      keyword_ids: cappedScopeSelectedIds.slice(1),
    });
  });

  it('emits empty keyword scope when capped global selection is cleared', async () => {
    const onChange = vi.fn();
    render(<KeywordScopePicker {...buildSelectedCappedKeywordScopePickerProps({ onChange })} />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Clear all' }));

    expect(onChange).toHaveBeenCalledWith({
      mode: 'keywords',
      keyword_ids: [],
    });
  });

  it('emits empty keyword scope when capped section selection is cleared', async () => {
    const onChange = vi.fn();
    render(<KeywordScopePicker {...buildSelectedCappedKeywordScopePickerProps({ onChange })} />);
    const cappedSection = screen.getByRole('checkbox', { name: 'Select first 50 in Large group' });

    await userEvent.setup().click(cappedSection);

    expect(onChange).toHaveBeenLastCalledWith({
      mode: 'keywords',
      keyword_ids: [],
    });
  });

  it('emits all scope without ID arrays when all mode is selected', async () => {
    const onChange = vi.fn();
    render(<KeywordScopePicker {...buildKeywordScopePickerProps(['k1'], { onChange })} />);

    await userEvent.setup().click(screen.getByRole('radio', { name: 'All' }));

    expect(onChange).toHaveBeenCalledWith({ mode: 'all' });
  });

  it('renders all mode controls when allowedModes is omitted', () => {
    render(<KeywordScopePicker {...buildScopedKeywordScopePickerProps()} />);

    expect(screen.getByRole('radio', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Groups' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Keywords' })).toBeInTheDocument();
  });

  it('omits all from mode controls when all is disallowed', () => {
    render(<KeywordScopePicker {...buildGroupScopePickerProps([], { allowedModes: ['groups', 'keywords'] })} />);

    expect(screen.queryByRole('radio', { name: 'All' })).not.toBeInTheDocument();
  });

  it('renders no ID picker when all scope is authoritative', () => {
    render(<KeywordScopePicker {...buildScopedKeywordScopePickerProps()} />);

    expect(screen.queryByRole('searchbox', { name: 'Search keywords' })).not.toBeInTheDocument();
  });

  it('marks capped section indeterminate when only selectable prefix is selected', () => {
    render(<KeywordScopePicker {...buildSelectedCappedKeywordScopePickerProps()} />);

    const header = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select first 50 in Large group' });

    expect(header.indeterminate).toBe(true);
    expect(header.checked).toBe(false);
  });

  it('changes only visible section members when search filters a group', async () => {
    const onChange = vi.fn();
    render(<KeywordScopePicker {...buildKeywordScopePickerProps(['k3'], { onChange })} />);
    await userEvent.setup().type(
      screen.getByRole('searchbox', { name: 'Search keywords' }),
      'spa'
    );

    await userEvent.setup().click(
      screen.getByRole('checkbox', { name: 'Select all in Hotel Coruña' })
    );

    expect(onChange).toHaveBeenCalledWith({
      mode: 'keywords',
      keyword_ids: ['k1', 'k3'],
    });
  });

  it('does not restore prior IDs when returning to a mode', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <KeywordScopePicker {...buildGroupScopePickerProps(['coruna'], { onChange })} />
    );
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Keywords' }));
    expect(onChange).toHaveBeenLastCalledWith({
      mode: 'keywords',
      keyword_ids: [],
    });
    rerender(<KeywordScopePicker {...buildKeywordScopePickerProps(['k1'], { onChange })} />);

    await userEvent.setup().click(screen.getByRole('radio', { name: 'Groups' }));

    expect(onChange).toHaveBeenLastCalledWith({
      mode: 'groups',
      group_ids: [],
    });
  });

  it('shows known selections without emitting when parent scope contains stale IDs', () => {
    const onChange = vi.fn();
    render(<KeywordScopePicker {...buildKeywordScopePickerProps(['missing'], { onChange })} />);

    expect(screen.getByText('0 of 4 selected')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('omits mode controls when legacy props are used', () => {
    render(
      <KeywordScopePicker
        idPrefix="legacy-keyword-scope"
        name="legacy-keyword-ids"
        keywords={keywords}
        groups={[coruna, marino]}
        selectedIds={[]}
        onChange={vi.fn()}
      />
    );

    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });
});
