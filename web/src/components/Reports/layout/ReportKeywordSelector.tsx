import type { Keyword } from '../../../types';
import {
  REPORT_CONTROL_LABEL_CLASS, REPORT_CONTROL_SELECT_CLASS
} from './reportControls';

interface Props {
  readonly keywords: ReadonlyArray<Keyword>;
  readonly selected: string | null;
  readonly onChange: (keyword: string) => void;
}

/**
 * Keyword selector reused across reports that scope their data to a single
 * keyword. Lives in the report's `actions` slot in screen mode and is hidden
 * from the printout (selection is reflected in the URL/H1 instead).
 */
export function ReportKeywordSelector({
  keywords,
  selected,
  onChange,
}: Props) {
  return (
    <div className="w-full min-w-0 sm:w-[26rem]">
      <label
        htmlFor="report-keyword-select"
        className={REPORT_CONTROL_LABEL_CLASS}
      >
        Keyword
      </label>
      <select
        id="report-keyword-select"
        value={selected ?? ''}
        onChange={(event) => onChange(event.target.value)}
        className={REPORT_CONTROL_SELECT_CLASS}
      >
        {!selected && <option value="">Select a keyword…</option>}
        {[...keywords].sort((a, b) => a.keyword.localeCompare(b.keyword, undefined, { sensitivity: 'base' })).map((keyword) => (
          <option key={keyword.keyword} value={keyword.keyword}>
            {keyword.keyword}
          </option>
        ))}
      </select>
    </div>
  );
}
