import {
  render, screen
} from '@testing-library/react';
import {
  describe, expect, it, vi
} from 'vitest';
import {
  buildGroup, buildKeyword
} from '../../api/keywordGroups-fixtures';
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

  /**
   * REGRESSION: the panel promised runs that the scope could not resolve.
   *
   * A no-selection run resolves to active keywords only, and so does a group
   * run, but the summary line counted the whole keyword library and the group
   * buttons counted paused members. An install with 53 keywords of which 13
   * were active read "All 53 active keywords", and a group holding only paused
   * keywords offered an enabled button that failed with "No active keywords
   * match the selected scope (1 group(s))".
   */
  const renderTriggerSection = (props: Partial<Parameters<typeof TriggerSection>[0]> = {}) => render(
    <TriggerSection
      selectedIds={[]}
      keywordsCount={53}
      activeKeywords={[
        buildKeyword({
          id: 'keyword-1',
          keyword: 'accessible hotels',
          group_ids: [],
        }),
      ]}
      groups={[]}
      isRunning={false}
      isStarting={false}
      onSelectionChange={vi.fn()}
      onTriggerAnalysis={vi.fn()}
      onRunGroup={vi.fn()}
      isAdmin
      {...props}
    />
  );

  it('summarizes a no-selection run by the active keywords it will resolve, not the library size', () => {
    renderTriggerSection();

    expect(screen.getByText('All 1 active keywords')).toBeInTheDocument();
    expect(screen.queryByText('All 53 active keywords')).not.toBeInTheDocument();
  });

  it('disables a group button that has no active keywords and says why', () => {
    renderTriggerSection({
      groups: [buildGroup({
        id: 'group-branson',
        name: 'Hotel Branson',
        keyword_count: 0,
      })],
    });

    const button = screen.getByRole('button', { name: /Hotel Branson/u });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Hotel Branson has no active keywords to run');
  });

  it('keeps a group button enabled when the group has active keywords', () => {
    renderTriggerSection({
      groups: [buildGroup({
        id: 'group-st-louis',
        name: 'Hotel St Louis',
        keyword_count: 1,
      })],
    });

    const button = screen.getByRole('button', { name: /Hotel St Louis/u });

    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('title');
  });
});
