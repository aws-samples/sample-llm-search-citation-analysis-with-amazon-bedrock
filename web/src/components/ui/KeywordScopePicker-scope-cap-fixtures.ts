import {
  buildGroup, buildKeyword
} from '../../api/keywordGroups-fixtures';
import { MAX_SCOPE_KEYWORD_IDS } from './KeywordScopePicker-selection';

const OVER_CAP_GROUP_ID = 'over-cap-group';

/** One keyword more than a run scope may name. */
export const overCapKeywords = Array.from(
  { length: MAX_SCOPE_KEYWORD_IDS + 1 },
  (_value, index) => buildKeyword({
    id: `over-cap-${index + 1}`,
    keyword: `Over cap keyword ${index + 1}`,
    group_ids: [OVER_CAP_GROUP_ID],
  })
);

export const overCapGroup = buildGroup({
  id: OVER_CAP_GROUP_ID,
  name: 'Every hotel',
  keyword_count: overCapKeywords.length,
});

export const firstCapKeywordIds = overCapKeywords
  .slice(0, MAX_SCOPE_KEYWORD_IDS)
  .map((keyword) => keyword.id);

const lastOverCapKeyword = overCapKeywords[MAX_SCOPE_KEYWORD_IDS];

/**
 * Checkbox id of the 1001st keyword under the shared `test-keyword-scope`
 * prefix; a direct id lookup, because role and label queries over 1001
 * checkboxes take minutes in jsdom.
 */
export const LAST_OVER_CAP_CHECKBOX_ID =
  `test-keyword-scope-section-${OVER_CAP_GROUP_ID}-keyword-${lastOverCapKeyword.id}`;

export const SCOPE_CAP_HINT_TEXT =
  'Runs take at most 1,000 selected keywords. Run whole groups to include more; group runs have no cap.';
