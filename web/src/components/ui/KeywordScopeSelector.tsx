import { useId } from 'react';
import type {
  Keyword, KeywordGroup, ReportScope
} from '../../types';
import {
  decodeReportScope, encodeReportScope
} from './reportScope';

interface KeywordScopeSelectorProps {
  readonly keywords: Keyword[];
  readonly groups: KeywordGroup[];
  readonly value: ReportScope;
  readonly onChange: (scope: ReportScope) => void;
  readonly label?: string;
  /** Hide the "All keywords" option where a whole-account answer makes no sense. */
  readonly allowAll?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
}

/**
 * One dropdown to pick what a KPI view covers: every keyword, a keyword group
 * (a hotel), or a single keyword. Groups are listed with their member counts.
 */
export function KeywordScopeSelector({
  keywords, groups, value, onChange, label = 'Scope', allowAll = true, disabled = false, className = ''
}: KeywordScopeSelectorProps) {
  const id = useId();
  const sortedGroups = [...groups].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
  const sortedKeywords = [...keywords].sort((left, right) => left.keyword.localeCompare(right.keyword, undefined, { sensitivity: 'base' }));

  return (
    <div className={className}>
      <label htmlFor={id} className="block text-xs font-medium text-gray-500 mb-1.5">{label}</label>
      <select
        id={id}
        value={encodeReportScope(value)}
        disabled={disabled}
        onChange={(event) => onChange(decodeReportScope(event.target.value))}
        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 text-sm bg-gray-50 disabled:opacity-50"
      >
        {allowAll && <option value="all">All keywords</option>}
        {sortedGroups.length > 0 && (
          <optgroup label="Keyword groups">
            {sortedGroups.map((group) => (
              <option key={group.id} value={`group:${group.id}`}>
                {group.name} ({group.keyword_count})
              </option>
            ))}
          </optgroup>
        )}
        {sortedKeywords.length > 0 && (
          <optgroup label="Keywords">
            {sortedKeywords.map((keyword) => (
              <option key={keyword.id} value={`keyword:${keyword.keyword}`}>{keyword.keyword}</option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}
