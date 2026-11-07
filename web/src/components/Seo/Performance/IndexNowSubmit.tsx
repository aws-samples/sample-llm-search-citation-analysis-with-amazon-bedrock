/**
 * IndexNow submission (Admin): pasted URLs or the pages of the latest finished audit, sent per host to Bing,
 * then Yandex, then Yep; each host's outcome and each engine's answer are shown. Free.
 */
import { useState } from 'react';
import type {
  ActionState, IndexNowController
} from '../../../hooks/usePerformanceIndexNow';
import type {
  HostSubmission, IndexNowSubmission
} from '../../../types/api/seoPerformance';
import { Button } from '../../ui/Button';
import { ErrorAlert } from '../../ui/ErrorAlert';

const ENGINE_LABELS: Record<HostSubmission['engines'][number]['engine'], string> = {
  bing: 'Bing',
  yandex: 'Yandex',
  yep: 'Yep',
};

/** One URL per line (or separated by spaces or commas); blanks dropped. */
function pastedUrls(text: string): string[] {
  return text.split(/[\s,]+/).map((entry) => entry.trim()).filter((entry) => entry !== '');
}

export function HostOutcome({ host }: { readonly host: HostSubmission }) {
  return (
    <li className="py-2">
      <p className={host.status === 'submitted' ? 'text-emerald-800' : 'text-red-700'}>
        <span className="font-medium">{host.host}</span> ({String(host.url_count)} URLs): {host.message}
      </p>
      {host.engines.length > 0 && (
        <ul className="pl-4 text-xs text-gray-600">
          {host.engines.map((answer) => (
            <li key={answer.engine}>
              {ENGINE_LABELS[answer.engine]}: {answer.http_status === null ? 'no answer' : `HTTP ${String(answer.http_status)}`} · {answer.message}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function SubmissionOutcome({ submission }: { readonly submission: ActionState<IndexNowSubmission> }) {
  if (submission.status === 'idle') return null;
  if (submission.status === 'busy') return <output className="block text-sm text-gray-500">Submitting…</output>;
  if (submission.status === 'error') return <ErrorAlert message={submission.message} />;
  const { value } = submission;
  return (
    <div className="text-sm" aria-label="Submission result">
      {value.skipped_count > 0 && (
        <p className="text-xs text-gray-600">{String(value.skipped_count)} URLs skipped (not on the brand&apos;s own domains).</p>
      )}
      <ul className="divide-y divide-gray-100">{value.hosts.map((host) => <HostOutcome key={host.host} host={host} />)}</ul>
    </div>
  );
}

export function IndexNowSubmit({
  controller, isAdmin, maxUrls
}: {
  readonly controller: IndexNowController;
  readonly isAdmin: boolean;
  readonly maxUrls: number;
}) {
  const [text, setText] = useState('');
  const urls = pastedUrls(text);
  const busy = controller.submission.status === 'busy';
  if (!isAdmin) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-4" aria-label="Submit URLs">
        <h3 className="text-base font-semibold text-gray-900">Submit URLs</h3>
        <p className="mt-2 text-sm text-gray-600">An Admin can submit changed pages to IndexNow.</p>
      </section>
    );
  }
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 space-y-3" aria-label="Submit URLs">
      <h3 className="text-base font-semibold text-gray-900">Submit URLs</h3>
      <p className="text-xs text-gray-500">
        Submit only pages that are new or changed. Up to {maxUrls.toLocaleString('en')} URLs on the brand&apos;s own domains; free.
      </p>
      <label className="block text-sm text-gray-700">
        URLs (one per line)
        <textarea
          className="mt-1 block h-28 w-full rounded-sm border border-gray-300 px-2 py-1 font-mono text-xs"
          value={text}
          onChange={(event) => { setText(event.target.value); }}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || urls.length === 0 || urls.length > maxUrls}
          onClick={() => { void controller.submit({
            source: 'paste',
            urls
          }); }}
        >
          Submit {String(urls.length)} URLs
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => { void controller.submit({ source: 'audit' }); }}>
          Submit the pages of the latest audit
        </Button>
      </div>
      <SubmissionOutcome submission={controller.submission} />
    </section>
  );
}
