import { useState } from 'react';
import type { FormEvent } from 'react';
import type { KeywordGroup } from '../../types';
import { formatDate } from '../../formatting/dateFormatter';
import { useContentChanges } from '../../hooks/useAlerts';
import {
  MAX_CONTENT_CHANGE_DESCRIPTION_LENGTH,
  MAX_CONTENT_CHANGE_URL_LENGTH,
  toContentChangeRequest,
  validateContentChangeForm,
} from './alertFormModel';
import type { ContentChangeFormValues } from './alertFormModel';

interface ContentChangeFormProps {
  readonly groups: KeywordGroup[];
  readonly groupsLoading: boolean;
  readonly groupsError: string | null;
  readonly isAdmin: boolean;
}

const EMPTY_CONTENT_CHANGE: ContentChangeFormValues = {
  groupId: '',
  description: '',
  url: '',
};

export function ContentChangeForm({
  groups, groupsLoading, groupsError, isAdmin
}: ContentChangeFormProps) {
  const [values, setValues] = useState<ContentChangeFormValues>(EMPTY_CONTENT_CHANGE);
  const [validationError, setValidationError] = useState<string | null>(null);
  const {
    latestMarker,
    loading,
    error,
    recording,
    recordOutcome,
    recordContentChange,
  } = useContentChanges(values.groupId);

  const updateValue = <TField extends keyof ContentChangeFormValues>(
    field: TField,
    value: ContentChangeFormValues[TField]
  ): void => {
    setValues((currentValues) => ({
      ...currentValues,
      [field]: value,
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const problem = validateContentChangeForm(values);
    setValidationError(problem);
    if (problem !== null) return;

    const outcome = await recordContentChange(toContentChangeRequest(values));
    if (outcome.success) {
      setValues((currentValues) => ({
        ...currentValues,
        description: '',
        url: '',
      }));
    }
  };

  const controlsDisabled = !isAdmin || recording || groupsLoading || groups.length === 0;

  return (
    <section aria-labelledby="content-change-heading" className="border-t border-gray-200 pt-6">
      <h4 id="content-change-heading" className="text-base font-semibold text-gray-900">
        Record content change
      </h4>
      <p className="mt-1 text-sm text-gray-600">
        Record a marker before publishing a change. This marker is required before an improvement alert
        can attribute a visibility gain to that content change.
      </p>

      {groupsError !== null && (
        <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {groupsError}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-4">
        <fieldset disabled={controlsDisabled} className="space-y-4">
          <legend className="sr-only">Content change marker details</legend>
          <label htmlFor="content-change-group" className="block">
            <span className="text-sm font-medium text-gray-800">Keyword group</span>
            <select
              id="content-change-group"
              value={values.groupId}
              onChange={(event) => updateValue('groupId', event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
            >
              <option value="">Select a keyword group</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>{group.name}</option>
              ))}
            </select>
          </label>

          <label htmlFor="content-change-description" className="block">
            <span className="text-sm font-medium text-gray-800">Description</span>
            <textarea
              id="content-change-description"
              required
              maxLength={MAX_CONTENT_CHANGE_DESCRIPTION_LENGTH}
              rows={3}
              value={values.description}
              onChange={(event) => updateValue('description', event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
            />
          </label>

          <label htmlFor="content-change-url" className="block">
            <span className="text-sm font-medium text-gray-800">URL (optional)</span>
            <input
              id="content-change-url"
              type="url"
              maxLength={MAX_CONTENT_CHANGE_URL_LENGTH}
              value={values.url}
              onChange={(event) => updateValue('url', event.target.value)}
              placeholder="https://example.com/page"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
            />
          </label>

          <button
            type="submit"
            disabled={controlsDisabled}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {recording ? 'Recording…' : 'Record content change'}
          </button>
        </fieldset>
      </form>

      {!isAdmin && (
        <p className="mt-3 text-sm text-gray-600">Only administrators can record content changes.</p>
      )}
      {!groupsLoading && groupsError === null && groups.length === 0 && (
        <p className="mt-3 text-sm text-gray-500">Create a keyword group before recording a content change.</p>
      )}
      {validationError !== null && (
        <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {validationError}
        </p>
      )}
      {recordOutcome !== null && (
        <output
          role={recordOutcome.success ? undefined : 'alert'}
          className={`mt-3 block rounded-lg border p-3 text-sm ${recordOutcome.success
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-red-200 bg-red-50 text-red-700'}`}
        >
          {recordOutcome.message}
        </output>
      )}

      {loading && <output className="mt-4 block text-sm text-gray-500">Loading the latest marker…</output>}
      {!loading && latestMarker !== null && (
        <article className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <h5 className="text-sm font-semibold text-gray-900">Latest content change</h5>
          <p className="mt-2 text-sm text-gray-700">{latestMarker.description}</p>
          <p className="mt-1 text-xs text-gray-500">
            Marker {latestMarker.id} · <time dateTime={latestMarker.changed_at}>{formatDate(latestMarker.changed_at)}</time>
          </p>
          {latestMarker.url !== undefined && (
            <a
              href={latestMarker.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block break-all text-sm text-blue-700 underline"
            >
              {latestMarker.url}
            </a>
          )}
        </article>
      )}
    </section>
  );
}
