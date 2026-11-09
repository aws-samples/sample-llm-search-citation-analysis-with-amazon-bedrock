import type {
  Keyword, KeywordGroup, ScheduleFormData
} from '../../types';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import {
  suggestScheduleName, type UpdateScheduleField
} from './scheduleFormModel';
import { ScheduleKindField } from './ScheduleKindField';
import {
  SCHEDULE_INPUT_CLASS, ScheduleTimingFields
} from './ScheduleTimingFields';
import { ScheduleScopeField } from './ScheduleScopeField';
import { ScheduleSwitch } from './ScheduleSwitch';

export type ScheduleFormMode = 'create' | 'edit';

/** Id of the form's title, which names the dialog around it. */
export const SCHEDULE_FORM_TITLE_ID = 'schedule-form-title';

interface ScheduleFormProps {
  mode: ScheduleFormMode;
  formData: ScheduleFormData;
  updateFormField: UpdateScheduleField;
  onSubmit: () => void;
  onCancel: () => void;
  saving: boolean;
  /** Active keywords for the "specific keywords" scope. */
  keywords: Keyword[];
  groups: KeywordGroup[];
  /** Shown when editing a schedule from before 2.3.0 whose keyword texts cannot be mapped to a scope. */
  legacyNotice?: string | null;
  /** Why the last save was refused, shown above the buttons. */
  error?: string | null;
}

const SECTION_GAP = 'space-y-6';

const NameField = ({
  formData, updateFormField, suggestion
}: Pick<ScheduleFormProps, 'formData' | 'updateFormField'> & { readonly suggestion: string }) => (
  <div>
    <div className="flex items-baseline justify-between mb-1">
      <label htmlFor="schedule-display-name" className="text-sm font-medium text-gray-900">Schedule name</label>
      <span className="text-xs text-gray-500">Optional</span>
    </div>
    <input
      id="schedule-display-name"
      name="schedule-display-name"
      type="text"
      value={formData.display_name}
      maxLength={100}
      placeholder={suggestion}
      aria-describedby="schedule-display-name-hint"
      onChange={(e) => updateFormField('display_name', e.target.value)}
      className={SCHEDULE_INPUT_CLASS}
    />
    <p id="schedule-display-name-hint" className="mt-1 text-xs text-gray-500">
      Left blank, it is saved with the name shown.
    </p>
  </div>
);

const FormFooter = ({
  mode, formData, updateFormField, onCancel, saving, error
}: Pick<ScheduleFormProps, 'mode' | 'formData' | 'updateFormField' | 'onCancel' | 'saving' | 'error'>) => (
  <div className="px-6 py-4 border-t border-gray-200">
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <ScheduleSwitch id="schedule-enabled" checked={formData.enabled}
          onChange={(checked) => updateFormField('enabled', checked)}>
          Enabled
        </ScheduleSwitch>
        <p className="text-xs text-gray-500 mt-0.5">{formData.enabled ? 'Runs on its own.' : 'Saved, but never runs.'}</p>
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving} leadingIcon={saving ? <Spinner size="sm" /> : undefined}>
          {submitLabel(mode, saving)}
        </Button>
      </div>
    </div>
  </div>
);

/**
 * Create / edit form for a schedule, drawn as the content of a flush dialog:
 * a title, a scrolling body in the order the user decides (what, when, which
 * keywords, then an optional name) and one footer with the Enabled switch,
 * Cancel and the save button. The caller pre-fills `formData` when editing
 * and saves with PUT instead of POST.
 */
export const ScheduleForm = ({
  mode, formData, updateFormField, onSubmit, onCancel, saving, keywords, groups, legacyNotice = null, error = null
}: ScheduleFormProps) => (
  <form
    className="flex flex-col min-h-0"
    aria-label={mode === 'create' ? 'Create schedule' : 'Edit schedule'}
    onSubmit={(event) => {
      event.preventDefault();
      onSubmit();
    }}
  >
    <div className="px-6 py-4 pr-14 border-b border-gray-200">
      <h3 id={SCHEDULE_FORM_TITLE_ID} className="text-lg font-semibold text-gray-900 break-words">
        {mode === 'create' ? 'New schedule' : `Edit “${formData.display_name}”`}
      </h3>
    </div>
    <div className={`px-6 py-5 overflow-y-auto ${SECTION_GAP}`}>
      {legacyNotice && (
        <p className="text-xs text-amber-700 bg-gray-50 border border-gray-200 rounded-sm px-3 py-2">{legacyNotice}</p>
      )}
      <ScheduleKindField editable={mode === 'create'} formData={formData} updateFormField={updateFormField} />
      <ScheduleTimingFields formData={formData} updateFormField={updateFormField} />
      {formData.kind === 'analysis' && (
        <ScheduleScopeField
          scope={formData.scope}
          onChange={(scope) => updateFormField('scope', scope)}
          keywords={keywords}
          groups={groups}
        />
      )}
      <NameField formData={formData} updateFormField={updateFormField} suggestion={suggestScheduleName(formData, groups)} />
    </div>
    <FormFooter mode={mode} formData={formData} updateFormField={updateFormField} onCancel={onCancel}
      saving={saving} error={error} />
  </form>
);

function submitLabel(mode: ScheduleFormMode, saving: boolean): string {
  if (saving) return 'Saving…';
  return mode === 'create' ? 'Create schedule' : 'Save changes';
}
