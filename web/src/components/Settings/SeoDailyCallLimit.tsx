import {
  useEffect, useState 
} from 'react';

/** The highest limit the server accepts (`SEO_DAILY_CALL_LIMIT_MAX` in `lambda/shared/config.py`). */
const MAX_LIMIT = 100_000;
const COUNT = new Intl.NumberFormat('en');

interface Props {
  /** Paid one-off DataForSEO calls each user may make per UTC day, as the server reads it. */
  readonly limit: number;
  readonly isAdmin: boolean;
  /** Saves a new limit; `false` when the server refused it (the page shows its reason). */
  readonly onSave: (limit: number) => Promise<boolean>;
}

function parsedLimit(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return value <= MAX_LIMIT ? value : null;
}

function limitSentence(limit: number): string {
  return limit === 0
    ? 'Paid DataForSEO lookups are off.'
    : `Each user may make up to ${COUNT.format(limit)} paid DataForSEO calls per day (UTC).`;
}

/**
 * The one daily limit of paid DataForSEO calls per user, which the SEO API enforces for the dashboard, the API
 * and AI assistants alike (`lambda/shared/seo_spend_limit.py`). An Admin edits it; everyone else reads it.
 */
export function SeoDailyCallLimit({
  limit, isAdmin, onSave
}: Props) {
  const [text, setText] = useState(String(limit));
  const [saving, setSaving] = useState(false);
  useEffect(() => setText(String(limit)), [limit]);

  const value = parsedLimit(text);
  const unchanged = value === limit;

  const save = async () => {
    if (value === null) return;
    setSaving(true);
    await onSave(value);
    setSaving(false);
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
      <h5 className="text-sm font-medium text-gray-900">Daily limit of paid DataForSEO calls</h5>
      <p className="text-xs text-gray-600">
        {limitSentence(limit)} It counts every billed call of a lookup from the dashboard, the API and AI assistants,
        and resets at midnight UTC. A cached answer costs nothing. SEO jobs an Admin starts (rank checks, snapshots,
        site audits) are confirmed with their price instead.
      </p>
      {isAdmin && (
        <div className="flex items-end gap-2">
          <label className="text-xs text-gray-700">
            Calls per user per day (0 turns paid lookups off)
            <input
              type="number"
              min={0}
              max={MAX_LIMIT}
              step={1}
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="mt-1 block w-40 px-2 py-1 text-sm border border-gray-300 rounded-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => void save()}
            disabled={value === null || unchanged || saving}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save limit'}
          </button>
          {value === null && <span role="alert" className="text-xs text-red-700">A whole number from 0 to {COUNT.format(MAX_LIMIT)}</span>}
        </div>
      )}
    </div>
  );
}
