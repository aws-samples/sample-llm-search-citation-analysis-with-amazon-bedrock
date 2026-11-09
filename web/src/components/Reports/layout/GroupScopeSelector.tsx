import { useNavigate } from 'react-router-dom';
import type {
  KeywordGroup, ReportScope
} from '../../../types';
import { KeywordScopeSelector } from '../../ui/KeywordScopeSelector';

interface Props {
  readonly groups: KeywordGroup[];
  readonly scope: ReportScope;
  /** The report's URL for a picked scope. */
  readonly pathFor: (scope: ReportScope) => string;
}

/**
 * The scope picker of the reports that cover every keyword or one keyword
 * group (no single keyword): picking one opens the report's URL for it.
 */
export function GroupScopeSelector({
  groups, scope, pathFor
}: Props) {
  const navigate = useNavigate();
  const open = (next: ReportScope) => navigate(pathFor(next));
  return (
    <KeywordScopeSelector
      keywords={[]}
      groups={groups}
      value={scope}
      onChange={open}
      label="Scope"
      className="w-full sm:w-80"
    />
  );
}
