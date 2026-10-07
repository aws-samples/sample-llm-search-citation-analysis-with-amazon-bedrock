import type { Keyword } from '../../types';
import { KeywordScopeSelector } from '../ui/KeywordScopeSelector';
import { useKeywordScopeOptions } from '../ui/useKeywordScopeOptions';
import type { ScopeSelection } from './useScopeSelection';

interface InsightsScopeSelectorProps {
  readonly keywords: Keyword[];
  /** The view's scope selection: what it covers and how to change it. */
  readonly selection: Pick<ScopeSelection, 'scope' | 'selectScope'>;
  readonly label: string;
}

/**
 * The scope picker of the insights views: every keyword, each keyword group
 * or one active keyword — the same choice the Visibility dashboard offers,
 * fed from the dashboard's keyword list and the keyword groups.
 */
export function InsightsScopeSelector({
  keywords, selection, label
}: InsightsScopeSelectorProps) {
  const {
    activeKeywords, groups
  } = useKeywordScopeOptions(keywords);

  return (
    <KeywordScopeSelector
      keywords={activeKeywords}
      groups={groups}
      value={selection.scope}
      onChange={selection.selectScope}
      label={label}
    />
  );
}
