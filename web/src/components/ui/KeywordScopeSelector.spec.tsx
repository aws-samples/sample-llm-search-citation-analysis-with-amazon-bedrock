import {
  describe, it, expect, vi 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KeywordScopeSelector } from './KeywordScopeSelector';
import type {
  Keyword, KeywordGroup 
} from '../../types';

const groups: KeywordGroup[] = [
  {
    id: 'g-marino',
    name: 'Hotel Marino',
    description: '',
    keyword_count: 2,
    created_at: '',
    updated_at: '' 
  },
  {
    id: 'g-coruna',
    name: 'Hotel Coruña',
    description: '',
    keyword_count: 3,
    created_at: '',
    updated_at: '' 
  },
];
const keywords: Keyword[] = [
  {
    id: 'k2',
    keyword: 'spa hotel galicia',
    created_at: '' 
  },
  {
    id: 'k1',
    keyword: 'Beach hotel coruna',
    created_at: '' 
  },
];

describe('KeywordScopeSelector', () => {
  it('lists all keywords, then groups with counts, then keywords, alphabetically', () => {
    render(<KeywordScopeSelector keywords={keywords} groups={groups} value={{ kind: 'all' }} onChange={vi.fn()} />);

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toStrictEqual([
      'All keywords', 'Hotel Coruña (3)', 'Hotel Marino (2)', 'Beach hotel coruna', 'spa hotel galicia',
    ]);
  });

  it('hides the all-keywords option when it is not allowed', () => {
    render(<KeywordScopeSelector keywords={keywords} groups={groups} value={{
      kind: 'group',
      groupId: 'g-coruna' 
    }} onChange={vi.fn()} allowAll={false} />);

    expect(screen.queryByRole('option', { name: 'All keywords' })).not.toBeInTheDocument();
  });

  it('reflects the current scope', () => {
    render(<KeywordScopeSelector keywords={keywords} groups={groups} value={{
      kind: 'keyword',
      keyword: 'spa hotel galicia' 
    }} onChange={vi.fn()} />);

    expect(screen.getByRole('combobox', { name: 'Scope' })).toHaveValue('keyword:spa hotel galicia');
  });

  it('reports a group selection as a group scope', async () => {
    const onChange = vi.fn();
    render(<KeywordScopeSelector keywords={keywords} groups={groups} value={{ kind: 'all' }} onChange={onChange} />);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Scope' }), 'group:g-coruna');

    expect(onChange).toHaveBeenCalledWith({
      kind: 'group',
      groupId: 'g-coruna' 
    });
  });

  it('reports a keyword selection as a keyword scope', async () => {
    const onChange = vi.fn();
    render(<KeywordScopeSelector keywords={keywords} groups={groups} value={{ kind: 'all' }} onChange={onChange} label="Analyze" />);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Analyze' }), 'keyword:Beach hotel coruna');

    expect(onChange).toHaveBeenCalledWith({
      kind: 'keyword',
      keyword: 'Beach hotel coruna' 
    });
  });
});
