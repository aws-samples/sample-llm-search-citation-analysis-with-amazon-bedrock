import type { ReactNode } from 'react';
import type { Keyword } from '../../types';
import { PageHeaderCard } from '../ui/PageHeaderCard';
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

interface InsightsPageHeaderProps {
  readonly title: string;
  readonly description: ReactNode;
  readonly keywords: Keyword[];
  readonly selection: Pick<ScopeSelection, 'scope' | 'selectScope'>;
}

/** The header card of an insights view: its title and description over the "Analyze" scope picker. */
export function InsightsPageHeader({
  title, description, keywords, selection
}: InsightsPageHeaderProps) {
  return (
    <PageHeaderCard title={title} description={description}>
      <InsightsScopeSelector keywords={keywords} selection={selection} label="Analyze" />
    </PageHeaderCard>
  );
}
