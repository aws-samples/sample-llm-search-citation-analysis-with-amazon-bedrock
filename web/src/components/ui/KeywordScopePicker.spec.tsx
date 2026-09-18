import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  KeywordScopePicker, UNGROUPED_SECTION_ID, buildSections
} from './KeywordScopePicker';
import {
  buildGroup, buildKeyword
} from '../../api/keywordGroups-fixtures';

const coruna = buildGroup({
  id: 'coruna',
  name: 'Hotel Coruña' 
});
const marino = buildGroup({
  id: 'marino',
  name: 'Hotel Gran Marino' 
});
const keywords = [
  buildKeyword({
    id: 'k1',
    keyword: 'coruña spa',
    group_ids: ['coruna'] 
  }),
  buildKeyword({
    id: 'k2',
    keyword: 'marino beach',
    group_ids: ['marino'] 
  }),
  buildKeyword({
    id: 'k3',
    keyword: 'galicia hotels',
    group_ids: ['coruna', 'marino'] 
  }),
  buildKeyword({
    id: 'k4',
    keyword: 'loose keyword' 
  }),
];

describe('buildSections', () => {
  it('lists a keyword under every group it belongs to and the rest under Ungrouped', () => {
    const sections = buildSections(keywords, [coruna, marino]);

    expect(sections.map((section) => [section.id, section.keywords.map((keyword) => keyword.id)])).toStrictEqual([
      ['coruna', ['k1', 'k3']],
      ['marino', ['k2', 'k3']],
      [UNGROUPED_SECTION_ID, ['k4']],
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

    expect(sections.map((section) => section.id)).toStrictEqual([UNGROUPED_SECTION_ID]);
  });
});

describe('KeywordScopePicker', () => {
  it('selects every keyword of a group when its header checkbox is ticked', async () => {
    const onChange = vi.fn();
    render(<KeywordScopePicker keywords={keywords} groups={[coruna, marino]} selectedIds={[]} onChange={onChange} />);

    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Select all in Hotel Coruña' }));

    expect(onChange).toHaveBeenCalledWith(['k1', 'k3']);
  });

  it('deselects the whole group when every member was already selected', async () => {
    const onChange = vi.fn();
    render(<KeywordScopePicker keywords={keywords} groups={[coruna, marino]} selectedIds={['k1', 'k3', 'k2']} onChange={onChange} />);

    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Select all in Hotel Coruña' }));

    expect(onChange).toHaveBeenCalledWith(['k2']);
  });

  it('marks a partially selected group as indeterminate', () => {
    render(<KeywordScopePicker keywords={keywords} groups={[coruna, marino]} selectedIds={['k1']} onChange={vi.fn()} />);

    const header = screen.getByRole('checkbox', { name: 'Select all in Hotel Coruña' }) as HTMLInputElement;

    expect(header.indeterminate).toBe(true);
    expect(header.checked).toBe(false);
  });

  it('toggles a single keyword by id even when it is listed under two groups', async () => {
    const onChange = vi.fn();
    render(<KeywordScopePicker keywords={keywords} groups={[coruna, marino]} selectedIds={[]} onChange={onChange} />);
    const marinoSection = screen.getByRole('region', { name: 'Hotel Gran Marino' });

    await userEvent.setup().click(within(marinoSection).getByLabelText('galicia hotels'));

    expect(onChange).toHaveBeenCalledWith(['k3']);
  });

  it('filters keywords by the search box and hides empty groups', async () => {
    render(<KeywordScopePicker keywords={keywords} groups={[coruna, marino]} selectedIds={[]} onChange={vi.fn()} />);

    await userEvent.setup().type(screen.getByRole('searchbox', { name: 'Search keywords' }), 'beach');

    expect(screen.getByRole('region', { name: 'Hotel Gran Marino' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Hotel Coruña' })).not.toBeInTheDocument();
  });

  it('shows the selection count and offers select all', async () => {
    const onChange = vi.fn();
    render(<KeywordScopePicker keywords={keywords} groups={[coruna, marino]} selectedIds={['k1']} onChange={onChange} />);

    expect(screen.getByText('1 of 4 selected')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Select all' }));
    expect(onChange).toHaveBeenCalledWith(['k1', 'k2', 'k3', 'k4']);
  });
});
