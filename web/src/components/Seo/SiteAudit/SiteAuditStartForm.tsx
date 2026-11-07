/**
 * Start an audit (Admin): pick one of the brand's own sites and a page limit, then confirm. The sites are the
 * owned domains of Settings › Brand Tracking (`GET /api/seo/audits` `sites`), the first one preselected.
 *
 * The confirmation states what the crawl does to the site (one request a second for up to N pages) and that it
 * uses no paid API; the audit starts only on confirm.
 */
import {
  useId, useState
} from 'react';
import { ConfirmModal } from '../../ui/Modal';
import { Button } from '../../ui';
import { ErrorAlert } from '../../ui/ErrorAlert';
import { SettingsHint } from '../SettingsHint';
import { crawlMinutes } from './siteAuditFormat';

interface SiteAuditStartFormProps {
  readonly sites: readonly string[];
  readonly maxPagesChoices: readonly number[];
  readonly starting: boolean;
  readonly error: string | null;
  readonly disabledReason: string | null;
  readonly onStart: (startUrl: string, maxPages: number) => void;
}

const DEFAULT_MAX_PAGES = 500;

export function SiteAuditStartForm({
  sites, maxPagesChoices, starting, error, disabledReason, onStart,
}: SiteAuditStartFormProps) {
  const siteId = useId();
  const pagesId = useId();
  const [site, setSite] = useState(sites[0] ?? '');
  const [maxPages, setMaxPages] = useState(
    maxPagesChoices.includes(DEFAULT_MAX_PAGES) ? DEFAULT_MAX_PAGES : (maxPagesChoices[0] ?? DEFAULT_MAX_PAGES)
  );
  const [confirming, setConfirming] = useState(false);

  if (sites.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <SettingsHint section="brand-config">Add the brand&apos;s own domains in Brand Tracking to audit its site.</SettingsHint>
      </div>
    );
  }

  return (
    <form
      className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap items-end gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setConfirming(true);
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={siteId} className="text-sm font-medium text-gray-700">Site</label>
        <select id={siteId} value={site} onChange={(event) => setSite(event.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
          {sites.map((domain) => <option key={domain} value={domain}>{domain}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={pagesId} className="text-sm font-medium text-gray-700">Max pages</label>
        <select id={pagesId} value={maxPages} onChange={(event) => setMaxPages(Number(event.target.value))}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
          {maxPagesChoices.map((choice) => <option key={choice} value={choice}>{choice.toLocaleString()}</option>)}
        </select>
      </div>
      <Button type="submit" disabled={starting || disabledReason !== null}>
        {starting ? 'Starting…' : 'Start audit'}
      </Button>
      {disabledReason !== null && <p className="text-sm text-gray-500">{disabledReason}</p>}
      <ErrorAlert message={error} spacingClassName="w-full " />
      <ConfirmModal
        isOpen={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => onStart(site, maxPages)}
        title="Start a site audit?"
        message={`The audit crawls up to ${maxPages.toLocaleString()} pages of ${site} at one request a second `
          + `(about ${crawlMinutes(maxPages)} minutes, longer if the site asks the crawler to slow down). `
          + 'It respects robots.txt and uses no paid API.'}
        confirmText="Start audit"
      />
    </form>
  );
}
