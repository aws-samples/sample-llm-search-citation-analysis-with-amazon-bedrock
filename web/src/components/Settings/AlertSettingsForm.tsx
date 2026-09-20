import {
  useEffect, useState
} from 'react';
import type { FormEvent } from 'react';
import type {
  AlertSettings, AlertSettingsUpdate, AlertSubscriptionStatus
} from '../../types';
import {
  alertSettingsFormValues,
  toAlertSettingsUpdate,
  validateAlertSettingsForm,
} from './alertFormModel';
import type { AlertSettingsFormValues } from './alertFormModel';

// Stryker disable next-line ObjectLiteral: replacing the Tailwind-only status palette has no behavioral effect
const SUBSCRIPTION_CLASSES: Record<AlertSubscriptionStatus, string> = {
  // Stryker disable next-line StringLiteral: confirmed status colors are presentation-only
  confirmed: 'rounded border px-2 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700 border-emerald-200',
  // Stryker disable next-line StringLiteral: pending status colors are presentation-only
  pending_confirmation: 'rounded border px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-800 border-amber-200',
  // Stryker disable next-line StringLiteral: unsubscribed status colors are presentation-only
  not_subscribed: 'rounded border px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 border-gray-200',
  // Stryker disable next-line StringLiteral: unknown status colors are presentation-only
  unknown: 'rounded border px-2 py-0.5 text-xs font-medium bg-red-50 text-red-700 border-red-200',
};

function subscriptionLabel(status: AlertSubscriptionStatus): string {
  return {
    confirmed: 'Confirmed',
    pending_confirmation: 'Pending confirmation',
    not_subscribed: 'Not subscribed',
    unknown: 'Unknown',
  }[status];
}

interface ThresholdFieldProps {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly value: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly step: number;
  readonly onChange: (value: string) => void;
}

function ThresholdField({
  id, label, unit, value, minimum, maximum, step, onChange
}: ThresholdFieldProps) {
  return (
    <label htmlFor={id} className="block">
      <span className="text-sm font-medium text-gray-800">{label}</span>
      <span className="mt-1 flex items-center gap-2">
        <input
          id={id}
          type="number"
          min={minimum}
          max={maximum}
          step={step}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
        />
        <span className="whitespace-nowrap text-xs text-gray-500">{unit}</span>
      </span>
    </label>
  );
}

interface AlertSettingsFormProps {
  readonly settings: AlertSettings;
  readonly isAdmin: boolean;
  readonly loading: boolean;
  readonly saving: boolean;
  readonly testing: boolean;
  readonly onSave: (settings: AlertSettingsUpdate) => Promise<unknown>;
  readonly onSendTestNotification: () => Promise<unknown>;
}

export function AlertSettingsForm({
  settings,
  isAdmin,
  loading,
  saving,
  testing,
  onSave,
  onSendTestNotification,
}: AlertSettingsFormProps) {
  const [values, setValues] = useState<AlertSettingsFormValues>(() => alertSettingsFormValues(settings));
  const [validationError, setValidationError] = useState<string | null>(null);
  const busy = loading || saving || testing;
  const hasConfirmedSubscription = settings.subscription_statuses.some(
    (subscription) => subscription.status === 'confirmed'
  );

  useEffect(() => {
    setValues(alertSettingsFormValues(settings));
    setValidationError(null);
  }, [settings]);

  const updateValue = <TField extends keyof AlertSettingsFormValues>(
    field: TField,
    value: AlertSettingsFormValues[TField]
  ): void => {
    setValues((currentValues) => ({
      ...currentValues,
      [field]: value,
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const problem = validateAlertSettingsForm(values);
    setValidationError(problem);
    if (problem === null) void onSave(toAlertSettingsUpdate(values));
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <fieldset disabled={!isAdmin || busy} className="space-y-5">
        <legend className="sr-only">Alert delivery and thresholds</legend>
        <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-4">
          <input
            type="checkbox"
            checked={values.enabled}
            onChange={(event) => updateValue('enabled', event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300"
          />
          <span>
            <span className="block text-sm font-medium text-gray-900">Enable alerts</span>
            <span className="mt-1 block text-xs text-gray-500">
              Evaluate configured thresholds after completed analysis runs.
            </span>
          </span>
        </label>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ThresholdField
            id="alert-citation-rate-drop"
            label="Citation-rate drop"
            unit="percentage points"
            value={values.citationRateDrop}
            minimum={0.1}
            maximum={100}
            step={0.1}
            onChange={(value) => updateValue('citationRateDrop', value)}
          />
          <ThresholdField
            id="alert-position-loss"
            label="Position loss"
            unit="rank places"
            value={values.positionLoss}
            minimum={0.1}
            maximum={100}
            step={0.1}
            onChange={(value) => updateValue('positionLoss', value)}
          />
          <ThresholdField
            id="alert-competitor-top-n"
            label="Competitor top N"
            unit="positions"
            value={values.competitorTopN}
            minimum={1}
            maximum={10}
            step={1}
            onChange={(value) => updateValue('competitorTopN', value)}
          />
          <ThresholdField
            id="alert-improvement-after-change"
            label="Improvement after content change"
            unit="visibility points"
            value={values.improvementAfterContentChange}
            minimum={0.1}
            maximum={100}
            step={0.1}
            onChange={(value) => updateValue('improvementAfterContentChange', value)}
          />
        </div>

        <label htmlFor="alert-notification-emails" className="block">
          <span className="text-sm font-medium text-gray-800">Notification emails</span>
          <textarea
            id="alert-notification-emails"
            rows={4}
            value={values.notificationEmailsText}
            onChange={(event) => updateValue('notificationEmailsText', event.target.value)}
            aria-describedby="alert-email-guidance"
            placeholder="alerts@example.com"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
          />
        </label>

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save alert settings'}
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => { void onSendTestNotification(); }}
              disabled={!hasConfirmedSubscription || busy}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send test notification
            </button>
          )}
        </div>
      </fieldset>

      {!isAdmin && (
        <p className="text-sm text-gray-600">Only administrators can change or save alert settings.</p>
      )}
      {validationError !== null && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {validationError}
        </p>
      )}

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <h4 className="text-sm font-semibold text-gray-900">Email subscription status</h4>
        <p id="alert-email-guidance" className="mt-1 text-xs text-gray-600">
          Amazon SNS sends a confirmation email to each address. Each recipient must choose
          {' '}Confirm subscription before alert emails can be delivered. Check spam or junk folders if it is missing.
        </p>
        {settings.subscription_statuses.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">No subscription status is available.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {settings.subscription_statuses.map((subscription) => (
              <li key={subscription.email} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="break-all text-gray-700">{subscription.email}</span>
                <output className={SUBSCRIPTION_CLASSES[subscription.status]}>
                  {subscriptionLabel(subscription.status)}
                </output>
              </li>
            ))}
          </ul>
        )}
      </div>
    </form>
  );
}
