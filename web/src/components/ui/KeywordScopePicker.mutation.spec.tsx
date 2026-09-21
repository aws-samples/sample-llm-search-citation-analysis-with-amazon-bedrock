import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  buildGroup, buildKeyword
} from '../../api/keywordGroups-fixtures';
import {
  KeywordScopePicker, buildSections
} from './KeywordScopePicker';
import {
  buildGroupScopePickerProps,
  buildKeywordScopePickerProps,
  buildScopedKeywordScopePickerProps,
  collapseScopePickerSection,
  renderLegacyKeywordScopePicker,
  renderScopedKeywordScopePicker,
  restoreScopePickerSection,
  scopePickerCorunaGroup,
  scopePickerGroups,
  scopePickerKeywords,
} from './KeywordScopePicker-fixtures';
import {buildCappedSectionKeywordScopePickerProps} from './KeywordScopePicker-mutation-fixtures';

const sectionHeaderStateCases = [
  {
    testName: 'checks a section header when every section keyword is selected',
    selectedIds: ['k1', 'k3'],
    expectedState: {
      checked: true,
      indeterminate: false,
    },
  },
  {
    testName: 'leaves a section header unchecked when no section keyword is selected',
    selectedIds: [],
    expectedState: {
      checked: false,
      indeterminate: false,
    },
  },
];

const sectionDisclosureCases = [
  {
    testName: 'hides section keywords when the section is collapsed',
    renderPicker: () => renderLegacyKeywordScopePicker(),
    toggleSection: collapseScopePickerSection,
    expectedState: {
      expanded: 'false',
      keywordVisible: false,
    },
  },
  {
    testName: 'restores section keywords when a collapsed section is expanded',
    renderPicker: () => renderLegacyKeywordScopePicker(),
    toggleSection: restoreScopePickerSection,
    expectedState: {
      expanded: 'true',
      keywordVisible: true,
    },
  },
  {
    testName: 'keeps section disclosure available when selection is disabled',
    renderPicker: () => renderScopedKeywordScopePicker({
      scope: {
        mode: 'keywords',
        keyword_ids: [],
      },
      disabled: true,
    }),
    toggleSection: collapseScopePickerSection,
    expectedState: {
      expanded: 'false',
      keywordVisible: false,
    },
  },
];

const globalCapSelectionCases = [
  {
    testName: 'floors a fractional keyword cap before selecting a prefix',
    selectedIds: [],
    maxKeywords: 1.9,
    buttonName: 'Select first 1',
    expectedIds: ['k1'],
  },
  {
    testName: 'offers uncapped selection when the cap equals the keyword count',
    selectedIds: [],
    maxKeywords: 4,
    buttonName: 'Select all',
    expectedIds: ['k1', 'k2', 'k3', 'k4'],
  },
  {
    testName: 'normalizes an over-cap controlled selection to the first capped prefix',
    selectedIds: scopePickerKeywords.map((keyword) => keyword.id),
    maxKeywords: 3,
    buttonName: 'Select first 3',
    expectedIds: ['k1', 'k2', 'k3'],
  },
];

const nonFiniteCapCases = [
  {
    testName: 'offers uncapped selection when the cap is not a number',
    maxKeywords: Number.NaN,
  },
  {
    testName: 'offers uncapped selection when the cap is infinite',
    maxKeywords: Number.POSITIVE_INFINITY,
  },
];

const cappedSectionToggleCases = [
  {
    testName: 'selects only remaining section capacity while preserving outside IDs',
    selectedIds: ['beta-1', 'beta-2'],
    maxKeywords: 3,
    controlName: 'Select first 1 in Alpha group',
    expectedIds: ['alpha-1', 'beta-1', 'beta-2'],
  },
  {
    testName: 'clears a capped section prefix while preserving outside IDs',
    selectedIds: ['alpha-1', 'beta-1', 'beta-2'],
    maxKeywords: 3,
    controlName: 'Select first 1 in Alpha group',
    expectedIds: ['beta-1', 'beta-2'],
  },
  {
    testName: 'normalizes a non-prefix section selection to the capped prefix',
    selectedIds: ['alpha-2', 'beta-1', 'beta-2'],
    maxKeywords: 3,
    controlName: 'Select first 1 in Alpha group',
    expectedIds: ['alpha-1', 'beta-1', 'beta-2'],
  },
  {
    testName: 'normalizes extra selected section members instead of clearing the target prefix',
    selectedIds: ['alpha-1', 'alpha-2', 'beta-1'],
    maxKeywords: 2,
    controlName: 'Select first 1 in Alpha group',
    expectedIds: ['alpha-1', 'beta-1'],
  },
  {
    testName: 'emits outside IDs when a selected section has a zero target',
    selectedIds: ['alpha-1', 'beta-1'],
    maxKeywords: 1,
    controlName: 'Select first 0 in Alpha group',
    expectedIds: ['beta-1'],
  },
];

const disabledGroupCases = [
  {
    testName: 'disables every group when the group cap is zero',
    props: buildGroupScopePickerProps([], { maxGroups: 0 }),
  },
  {
    testName: 'disables selected and unselected groups when the picker is disabled',
    props: buildGroupScopePickerProps(['coruna'], { disabled: true }),
  },
];

const singularGroup = buildGroup({
  id: 'single',
  name: 'Single',
  keyword_count: 1,
});
const singularKeyword = buildKeyword({
  id: 'single-keyword',
  keyword: 'Only keyword',
  group_ids: [singularGroup.id],
});
const singularSectionGroup = buildGroup({
  id: 'single-section',
  name: 'Single section',
});
const singularSectionKeyword = buildKeyword({
  id: 'single-section-keyword',
  keyword: 'Single section keyword',
  group_ids: [singularSectionGroup.id],
});
const singularCopyCases = [
  {
    testName: 'shows singular keyword copy when a group contains one keyword',
    props: buildGroupScopePickerProps([], {
      groups: [singularGroup],
      keywords: [singularKeyword],
    }),
  },
  {
    testName: 'reports singular section copy when a section contains one keyword',
    props: buildKeywordScopePickerProps([], {
      groups: [singularSectionGroup],
      keywords: [singularSectionKeyword],
    }),
  },
];

describe('buildSections mutation boundaries', () => {
  it('omits declared groups when they contain no keywords', () => {
    const sections = buildSections(
      [scopePickerKeywords[0]],
      [scopePickerCorunaGroup, scopePickerGroups[1]]
    );

    expect(sections.map((section) => section.id)).toStrictEqual(['coruna']);
  });

  it('returns no sections when no keywords exist', () => {
    expect(buildSections([], scopePickerGroups)).toStrictEqual([]);
  });

  it('places missing memberships in the ungrouped section', () => {
    const sections = buildSections([
      buildKeyword({
        id: 'missing-membership',
        group_ids: undefined
      }),
    ], scopePickerGroups);

    expect(sections.map((section) => section.name)).toStrictEqual(['Ungrouped']);
  });
});

describe('KeywordScopePicker search and tri-state outcomes', () => {
  it('matches a keyword when search text has different case and surrounding whitespace', async () => {
    renderLegacyKeywordScopePicker();

    await userEvent.setup().type(
      screen.getByRole('searchbox', { name: 'Search keywords' }),
      '  BEACH  '
    );

    expect(screen.getByText('marino beach')).toBeInTheDocument();
    expect(screen.queryByText('coruña spa')).not.toBeInTheDocument();
  });

  it('shows the empty result when no keyword matches search text', async () => {
    renderLegacyKeywordScopePicker();

    await userEvent.setup().type(
      screen.getByRole('searchbox', { name: 'Search keywords' }),
      'not present'
    );

    expect(screen.getByText('No keywords match your search.')).toBeInTheDocument();
    expect(screen.queryAllByRole('region')).toStrictEqual([]);
  });

  it.each(sectionHeaderStateCases)('$testName', ({
    selectedIds, expectedState
  }) => {
    renderLegacyKeywordScopePicker(selectedIds);
    const header = screen.getByRole<HTMLInputElement>(
      'checkbox',
      { name: 'Select all in Hotel Coruña' }
    );

    expect({
      checked: header.checked,
      indeterminate: header.indeterminate,
    }).toStrictEqual(expectedState);
  });

  it('emits no keyword IDs when uncapped global selection is complete', async () => {
    const onChange = vi.fn();
    renderLegacyKeywordScopePicker(
      scopePickerKeywords.map((keyword) => keyword.id),
      { onChange }
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'Clear all' }));

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it.each(sectionDisclosureCases)('$testName', async ({
    renderPicker,
    toggleSection,
    expectedState,
  }) => {
    renderPicker();

    const sectionButton = await toggleSection();

    expect(sectionButton).toHaveAttribute('aria-expanded', expectedState.expanded);
    expect(Boolean(screen.queryByText('coruña spa'))).toBe(expectedState.keywordVisible);
  });

  it('keeps global bulk selection independent of a keyword search', async () => {
    const onChange = vi.fn();
    renderLegacyKeywordScopePicker([], { onChange });
    await userEvent.setup().type(
      screen.getByRole('searchbox', { name: 'Search keywords' }),
      'beach'
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'Select all' }));

    expect(onChange.mock.calls).toStrictEqual([[['k1', 'k2', 'k3', 'k4']]]);
  });
});

describe('KeywordScopePicker empty and stale input outcomes', () => {
  it('disables global selection when no keywords are available', () => {
    renderLegacyKeywordScopePicker([], {
      keywords: [],
      groups: []
    });

    expect(screen.getByText('0 of 0 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select all' })).toBeDisabled();
    expect(screen.getByText('No keywords match your search.')).toBeInTheDocument();
  });

  it('shows the empty group outcome when no groups are available', () => {
    render(<KeywordScopePicker {...buildGroupScopePickerProps([], { groups: [] })} />);

    expect(screen.getByText('0 of 0 groups selected')).toBeInTheDocument();
    expect(screen.getByText('No keyword groups available.')).toBeInTheDocument();
  });

  it('ignores stale group IDs without emitting a corrective change', () => {
    const onChange = vi.fn();
    render(<KeywordScopePicker {...buildGroupScopePickerProps(['missing'], { onChange })} />);

    expect(screen.getByText('0 of 2 groups selected')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ignores stale legacy keyword IDs in counts and later emissions', async () => {
    const onChange = vi.fn();
    renderLegacyKeywordScopePicker(['missing'], { onChange });
    const corunaSection = screen.getByRole('region', { name: 'Hotel Coruña' });

    await userEvent.setup().click(within(corunaSection).getByLabelText('coruña spa'));

    expect(screen.getByText('0 of 4 selected')).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(['k1']);
  });
});

describe('KeywordScopePicker cap boundaries', () => {
  it.each(disabledGroupCases)('$testName', ({ props }) => {
    render(<KeywordScopePicker {...props} />);

    expect({
      corunaDisabled: screen.getByRole<HTMLInputElement>(
        'checkbox',
        { name: 'Hotel Coruña' }
      ).disabled,
      marinoDisabled: screen.getByRole<HTMLInputElement>(
        'checkbox',
        { name: 'Hotel Gran Marino' }
      ).disabled,
    }).toStrictEqual({
      corunaDisabled: true,
      marinoDisabled: true,
    });
  });

  it('clamps a negative keyword cap to zero', () => {
    render(<KeywordScopePicker {...buildKeywordScopePickerProps([], { maxKeywords: -1 })} />);

    expect(screen.getByRole('button', { name: 'Select first 0' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Select first 0 in Hotel Coruña' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'coruña spa' })).toBeDisabled();
  });

  it.each(globalCapSelectionCases)('$testName', async ({
    selectedIds,
    maxKeywords,
    buttonName,
    expectedIds,
  }) => {
    const onChange = vi.fn();
    render(<KeywordScopePicker {...buildKeywordScopePickerProps(selectedIds, {
      maxKeywords,
      onChange,
    })} />);

    await userEvent.setup().click(screen.getByRole('button', { name: buttonName }));

    expect(onChange).toHaveBeenCalledWith({
      mode: 'keywords',
      keyword_ids: expectedIds,
    });
  });

  it('offers uncapped selection when the cap exceeds the keyword count', () => {
    render(<KeywordScopePicker {...buildKeywordScopePickerProps([], { maxKeywords: 5 })} />);

    expect(screen.getByRole('button', { name: 'Select all' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Select first/u })).not.toBeInTheDocument();
  });

  it.each(nonFiniteCapCases)('$testName', ({ maxKeywords }) => {
    render(<KeywordScopePicker {...buildKeywordScopePickerProps([], { maxKeywords })} />);

    expect({
      selectAllDisabled: screen.getByRole<HTMLButtonElement>(
        'button',
        { name: 'Select all' }
      ).disabled,
      keywordDisabled: screen.getByRole<HTMLInputElement>(
        'checkbox',
        { name: 'coruña spa' }
      ).disabled,
    }).toStrictEqual({
      selectAllDisabled: false,
      keywordDisabled: false,
    });
  });

  it.each(cappedSectionToggleCases)('$testName', async ({
    selectedIds,
    maxKeywords,
    controlName,
    expectedIds,
  }) => {
    const onChange = vi.fn();
    render(<KeywordScopePicker {...buildCappedSectionKeywordScopePickerProps(selectedIds, {
      maxKeywords,
      onChange,
    })} />);

    await userEvent.setup().click(screen.getByRole('checkbox', { name: controlName }));

    expect(onChange).toHaveBeenCalledWith({
      mode: 'keywords',
      keyword_ids: expectedIds,
    });
  });

  it('disables an empty section when outside selections consume the cap', () => {
    render(<KeywordScopePicker {...buildCappedSectionKeywordScopePickerProps(
      ['beta-1', 'beta-2'],
      { maxKeywords: 2 }
    )} />);

    expect(
      screen.getByRole('checkbox', { name: 'Select first 0 in Alpha group' })
    ).toBeDisabled();
  });

  it('counts hidden selected keywords against a filtered section cap', async () => {
    const onChange = vi.fn();
    render(<KeywordScopePicker {...buildCappedSectionKeywordScopePickerProps(['beta-1'], {
      maxKeywords: 2,
      onChange,
    })} />);
    await userEvent.setup().type(
      screen.getByRole('searchbox', { name: 'Search keywords' }),
      'Alpha first'
    );

    await userEvent.setup().click(
      screen.getByRole('checkbox', { name: 'Select all in Alpha group' })
    );

    expect(onChange).toHaveBeenCalledWith({
      mode: 'keywords',
      keyword_ids: ['alpha-1', 'beta-1'],
    });
  });
});

describe('KeywordScopePicker modes and disabled outcomes', () => {
  it('renders allowed modes in canonical order when caller order differs', () => {
    render(<KeywordScopePicker {...buildScopedKeywordScopePickerProps({allowedModes: ['keywords', 'all', 'groups'],})} />);

    expect(
      screen.getAllByRole('radio').map((radio) => radio.nextElementSibling?.textContent)
    ).toStrictEqual(['All', 'Groups', 'Keywords']);
  });

  it('renders no picker when the authoritative mode is disallowed', () => {
    const onChange = vi.fn();
    render(<KeywordScopePicker {...buildKeywordScopePickerProps(['k1'], {
      allowedModes: ['groups'],
      onChange,
    })} />);

    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/selected$/u)).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables scoped keyword selection controls when the picker is disabled', () => {
    render(<KeywordScopePicker {...buildKeywordScopePickerProps([], { disabled: true })} />);

    expect(screen.getByRole('radio', { name: 'Keywords' })).toBeDisabled();
    expect(screen.getByRole('searchbox', { name: 'Search keywords' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Select all' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'coruña spa' })).toBeDisabled();
  });

  it('does not emit a mode change when disabled', async () => {
    const onChange = vi.fn();
    render(<KeywordScopePicker {...buildKeywordScopePickerProps([], {
      disabled: true,
      onChange,
    })} />);

    await userEvent.setup().click(screen.getByRole('radio', { name: 'Groups' }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it.each(singularCopyCases)('$testName', ({ props }) => {
    render(<KeywordScopePicker {...props} />);

    expect(screen.getByText('1 keyword')).toBeInTheDocument();
  });
});

describe('KeywordScopePicker remaining mutation outcomes', () => {
  it('keeps a missing membership ungrouped when a group uses the mutation sentinel ID', () => {
    const sentinelGroup = buildGroup({
      id: 'Stryker was here',
      name: 'Sentinel group',
    });
    const sections = buildSections([
      buildKeyword({
        id: 'without-membership',
        group_ids: undefined
      }),
    ], [sentinelGroup]);

    expect(sections.map((section) => section.id)).toStrictEqual(['__ungrouped__']);
  });

  it('hides the empty-group message when groups exist', () => {
    render(<KeywordScopePicker {...buildGroupScopePickerProps([])} />);

    expect(screen.queryByText('No keyword groups available.')).not.toBeInTheDocument();
  });

  it('keeps a second group enabled while a finite group cap has capacity', async () => {
    const onChange = vi.fn();
    render(<KeywordScopePicker {...buildGroupScopePickerProps(['coruna'], {
      maxGroups: 2,
      onChange,
    })} />);
    const secondGroup = screen.getByRole('checkbox', { name: 'Hotel Gran Marino' });

    expect(secondGroup).toBeEnabled();
    await userEvent.setup().click(secondGroup);
    expect(onChange).toHaveBeenCalledWith({
      mode: 'groups',
      group_ids: ['coruna', 'marino'],
    });
  });

  it('keeps another keyword enabled while a finite keyword cap has capacity', () => {
    render(<KeywordScopePicker {...buildKeywordScopePickerProps(['k1'], {maxKeywords: 2,})} />);

    expect(screen.getByRole('checkbox', { name: 'marino beach' })).toBeEnabled();
  });

  it('keeps a selectable capped section enabled', () => {
    render(<KeywordScopePicker {...buildKeywordScopePickerProps([], {maxKeywords: 2,})} />);

    expect(
      screen.getByRole('checkbox', { name: 'Select all in Hotel Coruña' })
    ).toBeEnabled();
  });

  it('replaces a same-size non-prefix selection when only part of the prefix is selected', async () => {
    const threeKeywordGroup = buildGroup({
      id: 'three-keyword-group',
      name: 'Three keyword group',
      keyword_count: 3,
    });
    const threeKeywords = ['First', 'Second', 'Third'].map((keyword, index) => buildKeyword({
      id: `three-${index + 1}`,
      keyword,
      group_ids: [threeKeywordGroup.id],
    }));
    const onChange = vi.fn();
    render(<KeywordScopePicker {...buildKeywordScopePickerProps(['three-1', 'three-3'], {
      keywords: threeKeywords,
      groups: [threeKeywordGroup],
      maxKeywords: 2,
      onChange,
    })} />);

    await userEvent.setup().click(
      screen.getByRole('checkbox', { name: 'Select first 2 in Three keyword group' })
    );

    expect(onChange).toHaveBeenCalledWith({
      mode: 'keywords',
      keyword_ids: ['three-1', 'three-2'],
    });
  });

  it('hides the empty-search message when keywords are visible', () => {
    renderLegacyKeywordScopePicker();

    expect(screen.queryByText('No keywords match your search.')).not.toBeInTheDocument();
  });

  it('reports plural keyword copy when a group contains multiple keywords', () => {
    render(<KeywordScopePicker {...buildGroupScopePickerProps([])} />);

    expect(screen.getAllByText('2 keywords')).toHaveLength(2);
  });

  it('uses different radio group names for separate picker instances', () => {
    render(
      <>
        <KeywordScopePicker {...buildScopedKeywordScopePickerProps()} />
        <KeywordScopePicker {...buildScopedKeywordScopePickerProps()} />
      </>
    );
    const allModeRadios = screen.getAllByRole<HTMLInputElement>('radio', { name: 'All' });

    expect(allModeRadios[0]?.name).not.toBe(allModeRadios[1]?.name);
  });

  it('checks only the authoritative scope mode', () => {
    render(<KeywordScopePicker {...buildKeywordScopePickerProps([])} />);

    expect(screen.getByRole('radio', { name: 'All' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Groups' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Keywords' })).toBeChecked();
  });

  it('rebuilds global selection IDs when keywords change', async () => {
    const firstKeyword = scopePickerKeywords[0];
    const secondKeyword = scopePickerKeywords[1];
    const onChange = vi.fn();
    const { rerender } = render(<KeywordScopePicker {...buildKeywordScopePickerProps([], {
      keywords: [firstKeyword],
      groups: [],
      onChange,
    })} />);
    rerender(<KeywordScopePicker {...buildKeywordScopePickerProps([], {
      keywords: [firstKeyword, secondKeyword],
      groups: [],
      onChange,
    })} />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Select all' }));

    expect(onChange).toHaveBeenCalledWith({
      mode: 'keywords',
      keyword_ids: ['k1', 'k2'],
    });
  });

  it('updates checked keywords when controlled selection changes', () => {
    const { rerender } = render(
      <KeywordScopePicker {...buildKeywordScopePickerProps([])} />
    );

    rerender(<KeywordScopePicker {...buildKeywordScopePickerProps(['k1'])} />);

    expect(screen.getByText('1 of 4 selected')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'coruña spa' })).toBeChecked();
  });

  it('rebuilds exact sections when supplied groups change', () => {
    const { rerender } = render(<KeywordScopePicker {...buildKeywordScopePickerProps([], {groups: [scopePickerCorunaGroup],})} />);

    rerender(<KeywordScopePicker {...buildKeywordScopePickerProps([], {groups: [scopePickerGroups[1]],})} />);

    expect(screen.getAllByRole('region').map((region) => (
      region.getAttribute('aria-label')
    ))).toStrictEqual(['Hotel Gran Marino', 'Ungrouped']);
  });
});

describe('KeywordScopePicker controlled over-cap recovery', () => {
  it('keeps a selected section enabled when outside IDs leave a zero target', () => {
    render(<KeywordScopePicker {...buildCappedSectionKeywordScopePickerProps(
      ['alpha-1', 'beta-1'],
      { maxKeywords: 1 }
    )} />);

    expect(screen.getByRole(
      'checkbox',
      { name: 'Select first 0 in Alpha group' }
    )).toBeEnabled();
  });
});
