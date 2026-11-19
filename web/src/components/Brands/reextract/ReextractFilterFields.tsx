import type { KeywordGroup } from '../../../types';
import { integerText } from '../../ui/numberFormat';
import type { ReextractForm } from './reextractForm';

const CHECKBOX = 'h-4 w-4 rounded-sm border-gray-300 text-gray-900 focus:ring-2 focus:ring-gray-900';
const DATE_INPUT = 'rounded-lg border border-gray-200 p-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-gray-900';

interface ReextractFilterFieldsProps {
  readonly form: ReextractForm;
  readonly groups: readonly KeywordGroup[];
  readonly groupsError: string | null;
  readonly onChange: (form: ReextractForm) => void;
}

function toggledGroup(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];
}

/** Which stored answers to re-extract: keyword groups, an optional date range, and whether to skip current ones. */
export function ReextractFilterFields({
  form, groups, groupsError, onChange
}: ReextractFilterFieldsProps) {
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-1 text-sm font-semibold text-gray-900">Keyword groups</legend>
        <p className="mb-2 text-sm text-gray-500">None selected re-extracts the answers of every keyword.</p>
        {groupsError !== null && <p className="text-sm text-red-700">{groupsError}</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          {groups.map((group) => (
            <label key={group.id} className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={form.groupIds.includes(group.id)}
                onChange={() => onChange({
                  ...form,
                  groupIds: toggledGroup(form.groupIds, group.id),
                })}
                className={CHECKBOX}
              />
              <span className="text-sm text-gray-700">
                {group.name} <span className="text-gray-500">({integerText(group.keyword_count)} keywords)</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          From
          <input type="date" value={form.since} className={DATE_INPUT} onChange={(event) => onChange({
            ...form,
            since: event.target.value,
          })} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          To
          <input type="date" value={form.until} className={DATE_INPUT} onChange={(event) => onChange({
            ...form,
            until: event.target.value,
          })} />
        </label>
      </div>
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={form.onlyOutdated}
          onChange={(event) => onChange({
            ...form,
            onlyOutdated: event.target.checked,
          })}
          className={CHECKBOX}
        />
        <span className="text-sm text-gray-700">Only answers stored under an older rule</span>
      </label>
    </div>
  );
}
