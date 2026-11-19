import type { ReextractFilters } from '../../../api/reextractDecoders';

/** The filter fields as the form holds them: empty dates are `''`. */
export interface ReextractForm {
  readonly groupIds: readonly string[];
  readonly since: string;
  readonly until: string;
  readonly onlyOutdated: boolean;
}

export const INITIAL_REEXTRACT_FORM: ReextractForm = {
  groupIds: [],
  since: '',
  until: '',
  onlyOutdated: true,
};

/** The request body for the form: groups sorted, so the same choice always gives the same filters. */
export function reextractFilters(form: ReextractForm): ReextractFilters {
  return {
    group_ids: [...form.groupIds].sort((left, right) => left.localeCompare(right)),
    since: form.since === '' ? null : form.since,
    until: form.until === '' ? null : form.until,
    only_outdated: form.onlyOutdated,
  };
}

/** Whether two filter objects ask for the same answers. */
export function sameFilters(left: ReextractFilters, right: ReextractFilters): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
