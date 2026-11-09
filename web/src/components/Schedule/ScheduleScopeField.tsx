import type {
  AnalysisScope, Keyword, KeywordGroup
} from '../../types';
import { KeywordScopePicker } from '../ui/KeywordScopePicker';
import {
  keywordsInMarkets, scopeMarketIds, withMarketIds
} from '../Markets/marketScope';
import {
  KeywordGroupChecklist, MarketLimitDisclosure, ScopeModeRadios, type ScopeMode, type ScopeModeOption
} from './ScopeModeFields';

interface ScheduleScopeFieldProps {
  scope: AnalysisScope;
  onChange: (scope: AnalysisScope) => void;
  /** Active keywords for the "specific keywords" scope. */
  keywords: Keyword[];
  groups: KeywordGroup[];
}

function scopeForMode(mode: ScopeMode, previous: AnalysisScope): AnalysisScope {
  const markets = scopeMarketIds(previous);
  if (mode === 'groups') return withMarketIds({
    mode,
    group_ids: previous.mode === 'groups' ? previous.group_ids : []
  }, markets);
  if (mode === 'keywords') return withMarketIds({
    mode,
    keyword_ids: previous.mode === 'keywords' ? previous.keyword_ids : []
  }, markets);
  return withMarketIds({ mode: 'all' }, markets);
}

const SCHEDULE_SCOPE_OPTIONS: readonly ScopeModeOption[] = [
  {
    mode: 'all',
    label: 'All active keywords',
    hint: 'Every keyword that is active when the schedule runs.'
  },
  {
    mode: 'groups',
    label: 'Keyword groups',
    hint: 'Keywords added to a group later are included.'
  },
  {
    mode: 'keywords',
    label: 'Specific keywords',
    hint: 'A fixed list you pick now.'
  },
];

/**
 * What an analysis schedule runs, in the Run Analysis pattern: every active
 * keyword by default, whole keyword groups (resolved when the schedule fires)
 * or a hand-picked set, with markets behind "Limit to markets (optional)".
 */
export const ScheduleScopeField = ({
  scope, onChange, keywords, groups
}: ScheduleScopeFieldProps) => (
  <div>
    <ScopeModeRadios
      idPrefix="schedule"
      legend="Which keywords"
      options={SCHEDULE_SCOPE_OPTIONS}
      value={scope.mode}
      onChange={(mode) => onChange(scopeForMode(mode, scope))}
    />
    {scope.mode === 'groups' && (
      <KeywordGroupChecklist
        idPrefix="schedule"
        groups={groups}
        selectedIds={scope.group_ids}
        onChange={(groupIds) => onChange(withMarketIds({
          mode: 'groups',
          group_ids: groupIds
        }, scopeMarketIds(scope)))}
      />
    )}
    {scope.mode === 'keywords' && (
      <div className="mt-2">
        <KeywordScopePicker
          idPrefix="schedule-keyword-scope"
          name="schedule-keyword-ids"
          keywords={keywordsInMarkets(keywords, scopeMarketIds(scope))}
          groups={groups}
          selectedIds={scope.keyword_ids}
          onChange={(keywordIds) => onChange(withMarketIds({
            mode: 'keywords',
            keyword_ids: keywordIds
          }, scopeMarketIds(scope)))}
        />
      </div>
    )}
    <MarketLimitDisclosure idPrefix="schedule" selectedIds={scopeMarketIds(scope)}
      onChange={(marketIds) => onChange(withMarketIds(scope, marketIds))} />
  </div>
);
