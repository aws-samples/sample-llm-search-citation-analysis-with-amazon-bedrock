import type {
  KeywordGroup, ReportScope
} from '../../../types';
import { KeywordScopeSelector } from '../../ui/KeywordScopeSelector';

interface Props {
  readonly groups: KeywordGroup[];
  readonly value: ReportScope;
  readonly onChange: (scope: ReportScope) => void;
}

/** The "Scope" picker of a report without a per-keyword form: every keyword, or one keyword group (`?group=`). */
export function GroupScopeSelector({
  groups, value, onChange
}: Props) {
  return (
    <KeywordScopeSelector
      keywords={[]}
      groups={groups}
      value={value}
      onChange={onChange}
      label="Scope"
      className="w-full sm:w-80"
    />
  );
}
