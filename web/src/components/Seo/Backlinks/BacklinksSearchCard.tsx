import {
  useId, useState, type SubmitEvent
} from 'react';
import { Button } from '../../ui/Button';
import type {
  BacklinksScope, BacklinksTargetRequest
} from '../../../types/api/seoBacklinks';
import {
  DomainQuickPicks, NoOwnDomainHint
} from '../DomainQuickPicks';
import {
  effectiveTarget, submitLabel, type SettingsDomains
} from '../settingsDomains';
import {
  LOOKUP_NOTES, SCOPE_OPTIONS
} from './backlinksFormat';
import {
  impliedScope, scopeAllowed
} from './backlinksScope';

const MAX_TARGET_LENGTH = 2048;
const FIELD_CLASS = 'w-full p-2 border border-gray-200 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-gray-900';
const LABEL_CLASS = 'block text-sm font-medium text-gray-700 mb-1';

function isScope(value: string): value is BacklinksScope {
  return SCOPE_OPTIONS.some((option) => option.id === value);
}

interface BacklinksSearchCardProps {
  readonly searching: boolean;
  /** Settings › Brand Tracking merged with the tracked snapshot domains: default target and quick picks. */
  readonly domains: SettingsDomains;
  readonly onSearch: (request: BacklinksTargetRequest) => void;
}

/**
 * The target input and its scope. The scope follows what is typed (a root
 * domain means its subdomains, a path means that subfolder) until the user
 * picks one; a quick pick searches that domain with its subdomains at once.
 * An empty input means the brand's own domain from Settings ("Analyze example.com").
 */
export function BacklinksSearchCard({
  searching, domains, onSearch
}: BacklinksSearchCardProps) {
  const targetId = useId();
  const scopeId = useId();
  const [target, setTarget] = useState('');
  const [pickedScope, setPickedScope] = useState<BacklinksScope | null>(null);
  const resolved = effectiveTarget(target, domains.ownDomain);
  const scope = pickedScope ?? impliedScope(resolved);
  const allowed = scopeAllowed(resolved, scope);

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (resolved === '' || !allowed) return;
    onSearch({
      target: resolved,
      scope,
    });
  };

  const pick = (domain: string) => {
    setTarget(domain);
    setPickedScope(null);
    onSearch({
      target: domain,
      scope: 'subdomains',
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:flex-1">
          <label htmlFor={targetId} className={LABEL_CLASS}>Domain or URL</label>
          <input
            id={targetId}
            className={FIELD_CLASS}
            value={target}
            maxLength={MAX_TARGET_LENGTH}
            placeholder={domains.ownDomain ?? 'example.com or example.com/blog'}
            onChange={(event) => setTarget(event.target.value)}
          />
        </div>
        <div className="w-full sm:w-44">
          <label htmlFor={scopeId} className={LABEL_CLASS}>Scope</label>
          <select
            id={scopeId}
            className={FIELD_CLASS}
            value={scope}
            onChange={(event) => {
              if (isScope(event.target.value)) setPickedScope(event.target.value);
            }}
          >
            {SCOPE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id} title={option.description}>{option.label}</option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={searching || resolved === '' || !allowed} className="w-full whitespace-nowrap sm:w-auto">{submitLabel(target, domains.ownDomain, 'Search')}</Button>
      </div>
      {!allowed && <p className="text-sm text-amber-700">Add a path to use Subfolder (e.g. example.com/blog).</p>}
      <p className="text-xs text-gray-500">
        {SCOPE_OPTIONS.find((option) => option.id === scope)?.description}. {LOOKUP_NOTES.overview}
      </p>
      {domains.missingOwnDomain && <NoOwnDomainHint />}
      <DomainQuickPicks picks={domains.picks} onPick={pick} />
    </form>
  );
}
