import {
  render, screen
} from '@testing-library/react';
import {
  describe, expect, it, vi
} from 'vitest';
import { buildKeyword } from '../../api/keywordGroups-fixtures';
import { TriggerSection } from './ExecutionMonitorComponents';

describe('TriggerSection', () => {
  it('applies execution-specific identities to the shared keyword picker', () => {
    render(
      <TriggerSection
        selectedIds={[]}
        keywordsCount={1}
        activeKeywords={[buildKeyword({
          id: 'keyword-1',
          keyword: 'accessible hotels',
          group_ids: [],
        })]}
        groups={[]}
        isRunning={false}
        isStarting={false}
        onSelectionChange={vi.fn()}
        onTriggerAnalysis={vi.fn()}
        onRunGroup={vi.fn()}
        isAdmin
      />
    );

    const search = screen.getByLabelText<HTMLInputElement>('Search keywords');
    const keyword = screen.getByRole<HTMLInputElement>('checkbox', { name: 'accessible hotels' });

    expect({
      id: search.id,
      labelFor: search.labels?.[0]?.htmlFor,
      name: search.name,
    }).toStrictEqual({
      id: 'execution-keyword-scope-search',
      labelFor: 'execution-keyword-scope-search',
      name: 'execution-keyword-scope-search',
    });
    expect({
      id: keyword.id,
      labelFor: keyword.labels?.[0]?.htmlFor,
      name: keyword.name,
      value: keyword.value,
    }).toStrictEqual({
      id: 'execution-keyword-scope-section-__ungrouped__-keyword-keyword-1',
      labelFor: 'execution-keyword-scope-section-__ungrouped__-keyword-keyword-1',
      name: 'execution-keyword-ids',
      value: 'keyword-1',
    });
  });
});
