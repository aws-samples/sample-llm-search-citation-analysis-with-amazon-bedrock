import { screen } from '@testing-library/react';

type LabelledFormField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** The id, label target and form name of a form field, for asserting its page-specific identity. */
export function fieldIdentity(field: LabelledFormField) {
  return {
    id: field.id,
    labelFor: field.labels?.[0]?.htmlFor,
    name: field.name,
  };
}

/** `fieldIdentity` plus the submitted value, for checkboxes, radios and other valued fields. */
export function valuedFieldIdentity(field: LabelledFormField) {
  return {
    ...fieldIdentity(field),
    value: field.value,
  };
}

/** `fieldIdentity` of the form field labelled `label` on screen. */
export function labelledFieldIdentity(label: string) {
  return fieldIdentity(screen.getByLabelText<LabelledFormField>(label));
}

/** The identities of the shared keyword picker's search box and of its checkbox for `keyword`. */
export function keywordPickerIdentity(keyword: string) {
  return {
    search: fieldIdentity(screen.getByLabelText<HTMLInputElement>('Search keywords')),
    keyword: valuedFieldIdentity(screen.getByRole<HTMLInputElement>('checkbox', { name: keyword })),
  };
}
