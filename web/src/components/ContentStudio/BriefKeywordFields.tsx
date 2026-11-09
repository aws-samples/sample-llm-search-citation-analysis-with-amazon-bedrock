import type {
  AnalysisScope, ContentBriefScope, Keyword, KeywordGroup
} from '../../types';
import { KeywordScopePicker } from '../ui/KeywordScopePicker';
import {
  MarketLimitDisclosure, ScopeModeRadios, type ScopeModeOption
} from '../Schedule/ScopeModeFields';
import {
  scopeMarketIds, withMarketIds
} from '../Markets/marketScope';
import { FieldIssue } from './GroupBriefFields';
import { GROUP_BRIEF_MAX_KEYWORDS } from './GroupBriefForm-source';
import {
  describeBriefScope, emptyBriefScope
} from './briefScope';

const BRIEF_SCOPE_OPTIONS: readonly ScopeModeOption[] = [
  {
    mode: 'groups',
    label: 'A keyword group',
    hint: 'Every active keyword in the group you choose.',
  },
  {
    mode: 'keywords',
    label: 'Specific keywords',
    hint: `Pick up to ${GROUP_BRIEF_MAX_KEYWORDS} from the list.`,
  },
];

interface BriefKeywordFieldsProps {
  /** The active keywords the market filter keeps: what the picker offers. */
  readonly pickableKeywords: Keyword[];
  readonly groups: KeywordGroup[];
  readonly scope: ContentBriefScope;
  /** The active keywords the brief would cover. */
  readonly selectedKeywords: Keyword[];
  readonly disabled: boolean;
  readonly issue?: string;
  readonly onChange: (scope: ContentBriefScope) => void;
}

function groupOptionLabel(group: KeywordGroup): string {
  if (group.keyword_count === 0) return `${group.name} (no active keywords)`;
  return `${group.name} (${group.keyword_count} ${group.keyword_count === 1 ? 'keyword' : 'keywords'})`;
}

/** The one group a group brief covers, as a single select ("Choose a group…" until picked). */
function GroupSelect({
  groups, scope, disabled, onChange
}: Pick<BriefKeywordFieldsProps, 'groups' | 'disabled' | 'onChange'> & {readonly scope: Extract<ContentBriefScope, { mode: 'groups' }>;}) {
  if (groups.length === 0) {
    return (
      <p className="text-sm text-amber-700">
        No keyword groups yet. Create them in Settings › Keywords, or choose specific keywords.
      </p>
    );
  }
  return (
    <div className="sm:max-w-md">
      <label htmlFor="group-brief-group" className="block text-sm font-medium text-gray-900">Keyword group</label>
      <select
        id="group-brief-group"
        name="group-brief-group"
        value={scope.group_ids[0] ?? ''}
        onChange={(event) => onChange(withMarketIds({
          mode: 'groups',
          group_ids: event.target.value === '' ? [] : [event.target.value],
        }, scopeMarketIds(scope)))}
        disabled={disabled}
        className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-gray-900"
      >
        <option value="">Choose a group…</option>
        {groups.map((group) => (
          <option key={group.id} value={group.id} disabled={group.keyword_count === 0}>
            {groupOptionLabel(group)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** One live line saying what the brief covers, with the keyword list one click away. */
function ScopeSummary({
  scope, groups, keywords
}: {
  readonly scope: ContentBriefScope;
  readonly groups: KeywordGroup[];
  readonly keywords: Keyword[];
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3" aria-label="Target scope preview">
      <output aria-live="polite" className="block text-sm font-medium text-gray-900">
        {describeBriefScope(scope, groups, keywords.length)}
      </output>
      {keywords.length > 0 && (
        <details className="group mt-1">
          <summary className="cursor-pointer rounded-sm text-xs font-medium text-blue-700 hover:text-blue-800 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-900">
            Show the {keywords.length === 1 ? 'keyword' : `${keywords.length} keywords`}
          </summary>
          <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto text-xs text-gray-700">
            {keywords.map((keyword) => <li key={keyword.id} className="break-words">{keyword.keyword}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * Step 2 of the Content Brief, in the Run Analysis / Schedule pattern: a
 * keyword group (one select) or specific keywords (the searchable picker,
 * shown only once chosen), markets behind a disclosure, and a live summary.
 */
export function BriefKeywordFields({
  pickableKeywords, groups, scope, selectedKeywords, disabled, issue, onChange
}: BriefKeywordFieldsProps) {
  const marketIds = scopeMarketIds(scope);
  return (
    <>
      <ScopeModeRadios
        idPrefix="group-brief"
        legend="Pick keywords by"
        options={BRIEF_SCOPE_OPTIONS}
        value={scope.mode}
        onChange={(mode) => onChange(emptyBriefScope(mode, marketIds))}
        disabled={disabled}
      />
      {scope.mode === 'groups' && (
        <GroupSelect groups={groups} scope={scope} disabled={disabled} onChange={onChange} />
      )}
      {scope.mode === 'keywords' && (
        <KeywordScopePicker
          idPrefix="group-brief-keyword-scope"
          name="group-brief-keyword-ids"
          keywords={pickableKeywords}
          groups={groups}
          scope={scope}
          onChange={(nextScope: AnalysisScope) => {
            if (nextScope.mode === 'keywords') onChange(nextScope);
          }}
          allowedModes={['keywords']}
          maxKeywords={GROUP_BRIEF_MAX_KEYWORDS}
          disabled={disabled}
        />
      )}
      <MarketLimitDisclosure
        idPrefix="group-brief"
        selectedIds={marketIds}
        onChange={(nextMarketIds) => onChange(withMarketIds(scope, nextMarketIds))}
        disabled={disabled}
      />
      <ScopeSummary scope={scope} groups={groups} keywords={selectedKeywords} />
      <FieldIssue issue={issue} />
    </>
  );
}
