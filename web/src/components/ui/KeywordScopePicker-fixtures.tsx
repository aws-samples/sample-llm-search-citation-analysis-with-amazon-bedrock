import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  type Mock, vi
} from 'vitest';
import {
  buildGroup, buildKeyword
} from '../../api/keywordGroups-fixtures';
import type { AnalysisScope } from '../../types';
import {
  KeywordScopePicker,
  type KeywordScopePickerProps,
} from './KeywordScopePicker';

type LegacyKeywordScopePickerProps = Extract<
  KeywordScopePickerProps,
  { readonly selectedIds: readonly string[] }
>;
type LegacyPickerOverrides = Omit<Partial<LegacyKeywordScopePickerProps>, 'selectedIds'>;
type ScopedKeywordScopePickerProps = Extract<
  KeywordScopePickerProps,
  { readonly scope: AnalysisScope }
>;
export type ScopedPickerOverrides = Omit<Partial<ScopedKeywordScopePickerProps>, 'scope'>;

export const scopePickerCorunaGroup = buildGroup({
  id: 'coruna',
  name: 'Hotel Coruña',
});
export const scopePickerMarinoGroup = buildGroup({
  id: 'marino',
  name: 'Hotel Gran Marino',
});
export const scopePickerGroups = [scopePickerCorunaGroup, scopePickerMarinoGroup];
export const scopePickerKeywords = [
  buildKeyword({
    id: 'k1',
    keyword: 'coruña spa',
    group_ids: ['coruna'],
  }),
  buildKeyword({
    id: 'k2',
    keyword: 'marino beach',
    group_ids: ['marino'],
  }),
  buildKeyword({
    id: 'k3',
    keyword: 'galicia hotels',
    group_ids: ['coruna', 'marino'],
  }),
  buildKeyword({
    id: 'k4',
    keyword: 'loose keyword',
  }),
];

const CAPPED_SCOPE_GROUP_ID = 'large-group';
const CAPPED_SCOPE_KEYWORD_COUNT = 51;
const CAPPED_SCOPE_MAX_KEYWORDS = 50;

const cappedScopeKeywords = Array.from(
  { length: CAPPED_SCOPE_KEYWORD_COUNT },
  (_value, index) => buildKeyword({
    id: `capped-keyword-${index + 1}`,
    keyword: `Capped keyword ${index + 1}`,
    group_ids: [CAPPED_SCOPE_GROUP_ID],
  })
);
const cappedScopeGroup = buildGroup({
  id: CAPPED_SCOPE_GROUP_ID,
  name: 'Large group',
  keyword_count: cappedScopeKeywords.length,
});
export const cappedScopeSelectedIds = cappedScopeKeywords
  .slice(0, CAPPED_SCOPE_MAX_KEYWORDS)
  .map((keyword) => keyword.id);
const cappedSelectedKeywordScope: AnalysisScope = {
  mode: 'keywords',
  keyword_ids: cappedScopeSelectedIds,
};

function buildLegacyKeywordScopePickerProps(
  selectedIds: readonly string[],
  overrides: LegacyPickerOverrides = {}
): LegacyKeywordScopePickerProps {
  return {
    idPrefix: 'test-keyword-scope',
    name: 'test-keyword-ids',
    keywords: scopePickerKeywords,
    groups: scopePickerGroups,
    selectedIds: [...selectedIds],
    onChange: vi.fn(),
    ...overrides,
  };
}

export function renderLegacyKeywordScopePicker(
  selectedIds: readonly string[] = [],
  overrides: LegacyPickerOverrides = {}
) {
  return render(
    <KeywordScopePicker {...buildLegacyKeywordScopePickerProps(selectedIds, overrides)} />
  );
}

export function buildScopedKeywordScopePickerProps(
  overrides: Partial<ScopedKeywordScopePickerProps> = {}
): ScopedKeywordScopePickerProps {
  return {
    idPrefix: 'test-keyword-scope',
    name: 'test-keyword-ids',
    keywords: scopePickerKeywords,
    groups: scopePickerGroups,
    scope: { mode: 'all' },
    onChange: vi.fn(),
    ...overrides,
  };
}

export function renderScopedKeywordScopePicker(
  overrides: Partial<ScopedKeywordScopePickerProps> = {}
) {
  return render(<KeywordScopePicker {...buildScopedKeywordScopePickerProps(overrides)} />);
}

/** The checked / indeterminate state of the section header checkbox with the given label. */
export function sectionHeaderState(name: string) {
  const header = screen.getByRole<HTMLInputElement>('checkbox', { name });
  return {
    checked: header.checked,
    indeterminate: header.indeterminate,
  };
}

/** The id, label target and form name of a picker input, for asserting its page-specific identity. */
export function inputIdentity(input: HTMLInputElement) {
  return {
    id: input.id,
    labelFor: input.labels?.[0]?.htmlFor,
    name: input.name,
  };
}

/** `inputIdentity` plus the submitted value, for picker checkboxes. */
export function checkboxIdentity(checkbox: HTMLInputElement) {
  return {
    ...inputIdentity(checkbox),
    value: checkbox.value,
  };
}

export async function typeScopePickerSearch(text: string): Promise<void> {
  await userEvent.setup().type(screen.getByRole('searchbox', { name: 'Search keywords' }), text);
}

/** A picker control to click, optionally after typing a keyword search. */
interface ScopePickerControl {
  readonly role: 'button' | 'checkbox' | 'radio';
  readonly name: string;
  readonly search?: string;
}

async function clickScopePickerControl({
  role, name, search,
}: ScopePickerControl): Promise<void> {
  if (search !== undefined) await typeScopePickerSearch(search);
  await userEvent.setup().click(screen.getByRole(role, { name }));
}

/** Renders a scoped picker with a fresh onChange spy, clicks one control and returns the spy. */
export async function clickScopedPickerControl(
  props: ScopedKeywordScopePickerProps,
  control: ScopePickerControl
): Promise<Mock<(scope: AnalysisScope) => void>> {
  const onChange = vi.fn<(scope: AnalysisScope) => void>();
  render(<KeywordScopePicker {...props} onChange={onChange} />);
  await clickScopePickerControl(control);
  return onChange;
}

/** Renders a legacy picker with a fresh onChange spy, clicks one control and returns the spy. */
export async function clickLegacyPickerControl(
  selectedIds: readonly string[],
  control: ScopePickerControl,
  overrides: LegacyPickerOverrides = {}
): Promise<Mock<(selectedIds: string[]) => void>> {
  const onChange = vi.fn<(selectedIds: string[]) => void>();
  renderLegacyKeywordScopePicker(selectedIds, {
    ...overrides,
    onChange,
  });
  await clickScopePickerControl(control);
  return onChange;
}

export async function collapseScopePickerSection(): Promise<HTMLElement> {
  const sectionButton = screen.getByRole('button', { name: /Hotel Coruña/u });
  await userEvent.setup().click(sectionButton);
  return sectionButton;
}

export async function restoreScopePickerSection(): Promise<HTMLElement> {
  const sectionButton = await collapseScopePickerSection();
  await userEvent.setup().click(sectionButton);
  return sectionButton;
}

export function buildGroupScopePickerProps(
  groupIds: readonly string[], overrides: ScopedPickerOverrides = {}
): ScopedKeywordScopePickerProps {
  return buildScopedKeywordScopePickerProps({
    scope: {
      mode: 'groups',
      group_ids: [...groupIds],
    },
    ...overrides,
  });
}

export function buildKeywordScopePickerProps(
  keywordIds: readonly string[], overrides: ScopedPickerOverrides = {}
): ScopedKeywordScopePickerProps {
  return buildScopedKeywordScopePickerProps({
    scope: {
      mode: 'keywords',
      keyword_ids: [...keywordIds],
    },
    ...overrides,
  });
}

export function buildCappedKeywordScopePickerProps(
  overrides: Partial<ScopedKeywordScopePickerProps> = {}
): ScopedKeywordScopePickerProps {
  return buildScopedKeywordScopePickerProps({
    keywords: cappedScopeKeywords,
    groups: [cappedScopeGroup],
    scope: {
      mode: 'keywords',
      keyword_ids: [],
    },
    maxKeywords: CAPPED_SCOPE_MAX_KEYWORDS,
    ...overrides,
  });
}

export function buildSelectedCappedKeywordScopePickerProps(
  overrides: ScopedPickerOverrides = {}
): ScopedKeywordScopePickerProps {
  return buildCappedKeywordScopePickerProps({
    scope: cappedSelectedKeywordScope,
    ...overrides,
  });
}
