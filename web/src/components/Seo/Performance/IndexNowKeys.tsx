/**
 * IndexNow key setup: one key per owned domain (created by an Admin), where to host it, and a free check
 * that the domain and its `www.` host serve it.
 */
import type {
  ActionState, IndexNowController
} from '../../../hooks/usePerformanceIndexNow';
import type {
  IndexNowSite, KeyFileCheck, KeyFileStatus
} from '../../../types/api/seoPerformance';
import { Button } from '../../ui/Button';
import { ErrorAlert } from '../../ui/ErrorAlert';
import { SettingsHint } from '../SettingsHint';

const KEY_FILE_LABELS: Record<KeyFileStatus, string> = {
  found: 'Key file found',
  missing: 'No key file',
  wrong_content: 'Wrong content',
  redirects: 'Redirects',
  moved: 'Forwards to another host',
  unreachable: 'Unreachable',
  unknown: 'Could not tell (engines will check)',
};

function CheckResult({ check }: { readonly check: ActionState<KeyFileCheck> | undefined }) {
  if (check === undefined || check.status === 'idle') return null;
  if (check.status === 'busy') return <output className="block text-sm text-gray-500">Checking…</output>;
  if (check.status === 'error') return <ErrorAlert message={check.message} />;
  return (
    <ul className="text-sm" aria-label={`Key file check of ${check.value.domain}`}>
      {check.value.hosts.map((host) => (
        <li key={host.host} className="py-1">
          <span className="font-medium text-gray-800">{host.host}</span>: {KEY_FILE_LABELS[host.status]}
          {host.problem !== null && <span className="block text-xs text-red-700">{host.problem}</span>}
        </li>
      ))}
    </ul>
  );
}

function SiteKey({
  site, controller, isAdmin
}: {
  readonly site: IndexNowSite;
  readonly controller: IndexNowController;
  readonly isAdmin: boolean;
}) {
  const check = controller.checks[site.domain];
  if (site.key === null) {
    return (
      <li className="py-3 space-y-2">
        <p className="text-sm text-gray-800"><span className="font-medium">{site.domain}</span> has no IndexNow key yet.</p>
        {isAdmin
          ? <Button size="sm" onClick={() => { void controller.createKey(site.domain); }}>Create key for {site.domain}</Button>
          : <p className="text-xs text-gray-500">An Admin can create it.</p>}
      </li>
    );
  }
  return (
    <li className="py-3 space-y-2">
      <p className="text-sm text-gray-800">
        <span className="font-medium">{site.domain}</span> key <code className="rounded-sm bg-gray-100 px-1">{site.key}</code>
      </p>
      <p className="text-xs text-gray-600">
        Publish a plain-text file named <code>{site.key}.txt</code> containing only the key at the root of each host you
        submit, without a redirect:
      </p>
      <ul className="list-disc pl-5 text-xs text-gray-600 break-all">
        {site.key_files.map((file) => <li key={file.host}>{file.url}</li>)}
      </ul>
      <Button variant="secondary" size="sm" onClick={() => { void controller.checkKeyFile(site.domain); }}>
        Check key file
      </Button>
      <CheckResult check={check} />
    </li>
  );
}

export function IndexNowKeys({
  sites, controller, isAdmin
}: {
  readonly sites: readonly IndexNowSite[];
  readonly controller: IndexNowController;
  readonly isAdmin: boolean;
}) {
  const { keyAction } = controller;
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4" aria-label="IndexNow keys">
      <h3 className="text-base font-semibold text-gray-900">Keys</h3>
      {sites.length === 0 && (
        <div className="mt-2">
          <SettingsHint section="brand-config">IndexNow submits the brand&apos;s own domains; add them first.</SettingsHint>
        </div>
      )}
      <ul className="divide-y divide-gray-100">
        {sites.map((site) => <SiteKey key={site.domain} site={site} controller={controller} isAdmin={isAdmin} />)}
      </ul>
      {keyAction.status === 'error' && <ErrorAlert message={keyAction.message} />}
    </section>
  );
}
