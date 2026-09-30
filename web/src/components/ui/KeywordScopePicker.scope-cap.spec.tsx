import {
  describe, expect, it, vi
} from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  buildSelectedCappedKeywordScopePickerProps,
  renderLegacyKeywordScopePicker,
  renderScopedKeywordScopePicker,
} from './KeywordScopePicker-fixtures';
import {
  LAST_OVER_CAP_CHECKBOX_ID,
  SCOPE_CAP_HINT_TEXT,
  firstCapKeywordIds,
  overCapGroup,
  overCapKeywords,
} from './KeywordScopePicker-scope-cap-fixtures';
import { MAX_SCOPE_KEYWORD_IDS } from './KeywordScopePicker-selection';

const overCapLists = {
  keywords: overCapKeywords,
  groups: [overCapGroup],
};

describe('KeywordScopePicker server scope cap', () => {
  it('mirrors the 1000-id MAX_SCOPE_IDS limit of lambda/shared/keyword_groups.py', () => {
    expect(MAX_SCOPE_KEYWORD_IDS).toBe(1000);
  });

  it('offers to select the first 1000 when a legacy picker lists 1001 keywords', () => {
    renderLegacyKeywordScopePicker([], overCapLists);

    expect(screen.getByRole('button', { name: 'Select first 1000' })).toBeEnabled();
  });

  it('emits the first 1000 keyword ids when legacy select-all runs over 1001 keywords', async () => {
    const onChange = vi.fn();
    renderLegacyKeywordScopePicker([], {
      ...overCapLists,
      onChange,
    });

    await userEvent.setup().click(screen.getByRole('button', { name: 'Select first 1000' }));

    expect(onChange).toHaveBeenCalledWith(firstCapKeywordIds);
  });

  it('disables the unchecked 1001st keyword when 1000 are selected in a legacy picker', () => {
    renderLegacyKeywordScopePicker(firstCapKeywordIds, overCapLists);

    expect(document.getElementById(LAST_OVER_CAP_CHECKBOX_ID)).toBeDisabled();
  });

  it('points at group runs when a legacy picker reaches the 1000-keyword cap', () => {
    renderLegacyKeywordScopePicker(firstCapKeywordIds, overCapLists);

    expect(screen.getByRole('status')).toHaveTextContent(SCOPE_CAP_HINT_TEXT);
  });

  it('omits the group-run hint when a legacy picker is below the cap', () => {
    renderLegacyKeywordScopePicker(firstCapKeywordIds.slice(1), overCapLists);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('omits the group-run hint when every keyword fits under the cap', () => {
    renderLegacyKeywordScopePicker(['k1', 'k2', 'k3', 'k4']);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('caps scoped keyword mode at 1000 when maxKeywords is omitted', () => {
    renderScopedKeywordScopePicker({
      ...overCapLists,
      scope: {
        mode: 'keywords',
        keyword_ids: firstCapKeywordIds,
      },
    });

    expect(document.getElementById(LAST_OVER_CAP_CHECKBOX_ID)).toBeDisabled();
  });

  it('keeps an explicit maxKeywords cap without the group-run hint', () => {
    renderScopedKeywordScopePicker(buildSelectedCappedKeywordScopePickerProps());

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
