import {
  useState, type SubmitEvent
} from 'react';
import type { DomainScope } from '../../../types/api/seoDomains';
import { Button } from '../../ui/Button';
import {
  DomainQuickPicks, NoOwnDomainHint
} from '../DomainQuickPicks';
import {
  effectiveTarget, submitLabel, type SettingsDomains
} from '../settingsDomains';

/** The scope options; "Auto" lets the input decide (a path = subfolder, else subdomains). */
export const SCOPE_OPTIONS: ReadonlyArray<{
  readonly id: DomainScope | 'auto';
  readonly label: string;
  readonly hint: string;
}> = [
  {
    id: 'auto',
    label: 'Auto',
    hint: 'Subfolder for a URL with a path, otherwise the domain and its subdomains',
  },
  {
    id: 'subdomains',
    label: 'Subdomains',
    hint: '*.example.com/*',
  },
  {
    id: 'domain',
    label: 'Domain',
    hint: 'example.com/* without subdomains',
  },
  {
    id: 'subfolder',
    label: 'Subfolder',
    hint: 'example.com/path/*',
  },
  {
    id: 'exact_url',
    label: 'Exact URL',
    hint: 'example.com/path only',
  },
];

const FIELD_CLASS = 'w-full p-2 border border-gray-200 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-gray-900';

interface Props {
  readonly busy: boolean;
  /** Settings › Brand Tracking: the default target and the quick picks. */
  readonly domains: SettingsDomains;
  readonly onAnalyze: (target: string, scope: DomainScope | undefined) => void;
}

function asScope(value: string): DomainScope | 'auto' {
  return SCOPE_OPTIONS.find((option) => option.id === value)?.id ?? 'auto';
}

/**
 * A domain or URL and its scope; Analyze is the paid action (overview + first keyword page). An empty input
 * means the brand's own domain from Settings ("Analyze example.com"); a quick pick analyzes that domain at once.
 */
export function DomainSearchForm({
  busy, domains, onAnalyze
}: Props) {
  const [target, setTarget] = useState('');
  const [scope, setScope] = useState<DomainScope | 'auto'>('auto');
  const resolved = effectiveTarget(target, domains.ownDomain);
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (resolved !== '') onAnalyze(resolved, scope === 'auto' ? undefined : scope);
  };
  const pick = (domain: string) => {
    setTarget(domain);
    setScope('auto');
    onAnalyze(domain, undefined);
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[14rem] text-sm text-gray-700">
          <span className="block mb-1 font-medium">Domain or URL</span>
          <input
            type="text"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            placeholder={domains.ownDomain ?? 'example.com or example.com/blog'}
            maxLength={2048}
            className={FIELD_CLASS}
          />
        </label>
        <label className="w-full text-sm text-gray-700 sm:w-auto">
          <span className="block mb-1 font-medium">Scope</span>
          <select
            value={scope}
            onChange={(event) => setScope(asScope(event.target.value))}
            className={FIELD_CLASS}
            title={SCOPE_OPTIONS.find((option) => option.id === scope)?.hint}
          >
            {SCOPE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <Button type="submit" disabled={busy || resolved === ''} className="w-full whitespace-nowrap sm:w-auto">{submitLabel(target, domains.ownDomain, 'Analyze')}</Button>
      </div>
      <div className="space-y-2">
        <DomainQuickPicks picks={domains.picks} onPick={pick} />
        {domains.missingOwnDomain && <NoOwnDomainHint />}
      </div>
      <p className="text-xs text-gray-400">
        Answers are cached for 12 hours. Labs covers the countries with keyword data
        from Labs only; other markets show &quot;not available&quot;.
      </p>
    </form>
  );
}
