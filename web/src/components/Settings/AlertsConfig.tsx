import { useAlertSettings } from '../../hooks/useAlerts';
import type { AlertMutationOutcome } from '../../hooks/useAlerts';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';
import { AlertSettingsForm } from './AlertSettingsForm';
import { ContentChangeForm } from './ContentChangeForm';

interface AlertsConfigProps { readonly isAdmin: boolean; }

interface AlertOutcomeNoticeProps {
  readonly outcome: AlertMutationOutcome;
  readonly warnings?: readonly string[];
}

function AlertOutcomeNotice({
  outcome, warnings = []
}: AlertOutcomeNoticeProps) {
  // Stryker disable next-line StringLiteral: success outcome colors are presentation-only
  const successClassName = 'border-emerald-200 bg-emerald-50 text-emerald-700';
  // Stryker disable next-line StringLiteral: failure outcome colors are presentation-only
  const failureClassName = 'border-red-200 bg-red-50 text-red-700';
  // Stryker disable next-line StringLiteral: base Tailwind outcome classes are presentation-only
  const outcomeClassName = `rounded-lg border p-3 text-sm ${outcome.success
    ? successClassName
    : failureClassName}`;
  return (
    <div className={outcomeClassName}>
      {outcome.success ? (
        <output>{outcome.message}</output>
      ) : (
        <p role="alert">{outcome.message}</p>
      )}
      {warnings.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
    </div>
  );
}

export function AlertsConfig({ isAdmin }: AlertsConfigProps) {
  const {
    settings,
    loading,
    error,
    saving,
    saveOutcome,
    testing,
    testOutcome,
    refresh,
    saveSettings,
    sendTestNotification,
  } = useAlertSettings();
  const {
    groups,
    loading: groupsLoading,
    error: groupsError,
  } = useKeywordGroups();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Alert configuration</h3>
          <p className="mt-1 text-sm text-gray-600">
            Configure threshold-based alerts and email delivery for every keyword group.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void refresh(); }}
          disabled={loading || saving || testing}
          className="self-start rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {error !== null && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {loading && settings === null && (
        <output className="block py-6 text-center text-sm text-gray-500">Loading alert settings…</output>
      )}
      {settings !== null && (
        <AlertSettingsForm
          settings={settings}
          isAdmin={isAdmin}
          loading={loading}
          saving={saving}
          testing={testing}
          onSave={saveSettings}
          onSendTestNotification={sendTestNotification}
        />
      )}

      {saveOutcome !== null && (
        <AlertOutcomeNotice outcome={saveOutcome} warnings={saveOutcome.warnings} />
      )}

      {testOutcome !== null && <AlertOutcomeNotice outcome={testOutcome} />}

      <ContentChangeForm
        groups={groups}
        groupsLoading={groupsLoading}
        groupsError={groupsError}
        isAdmin={isAdmin}
      />
    </div>
  );
}
