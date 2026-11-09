import { useState } from 'react';
import type { CompetitorDomains } from '../../api/competitorDomainsDecoders';
import { normalizeDomain } from '../../formatting/domainIdentity';
import {
  MAX_DOMAINS_PER_COMPETITOR, competitorDomainChoices, withCompetitorDomain, withoutCompetitorDomain
} from '../../hooks/competitorDomains';
import {
  Button, PlusIcon, TrashIcon
} from '../ui';
import { TagInput } from './TagInput';

interface CompetitorRowProps {
  readonly brand: string;
  readonly saved: string[];
  readonly suggested: string[];
  readonly onAddDomain: (domain: string) => void;
  readonly onRemoveDomain: (domain: string) => void;
  readonly onRemove: () => void;
}

/** A website "Find competitors" suggested and not saved yet: a dashed chip that saves it when clicked. */
function SuggestedDomainChip({
  brand, domain, disabled, onAdd
}: {
  readonly brand: string;
  readonly domain: string;
  readonly disabled: boolean;
  readonly onAdd: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onAdd}
      aria-label={`Add suggested ${domain} for ${brand}`}
      title="Suggested. Click to keep it."
      className="inline-flex max-w-full items-center gap-1 rounded-full border border-dashed border-gray-400 bg-white py-0.5 pl-1.5 pr-2.5 font-mono text-sm text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-gray-500 dark:focus-visible:ring-blue-400"
    >
      <PlusIcon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{domain}</span>
    </button>
  );
}

function CompetitorRow({
  brand, saved, suggested, onAddDomain, onRemoveDomain, onRemove
}: CompetitorRowProps) {
  const [draft, setDraft] = useState('');
  const atCap = saved.length >= MAX_DOMAINS_PER_COMPETITOR;
  const unsavedSuggestions = competitorDomainChoices(saved, suggested).filter((domain) => !saved.includes(domain));
  const commit = () => {
    const domain = normalizeDomain(draft);
    if (domain === null || atCap) return;
    onAddDomain(domain);
    setDraft('');
  };

  return (
    <li className="grid gap-2 px-4 py-2 hover:bg-gray-50 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto] sm:items-center sm:gap-2">
      <p className="text-sm font-medium text-gray-900 break-words">{brand}</p>
      <TagInput
        items={saved}
        draft={draft}
        onDraftChange={setDraft}
        onCommit={commit}
        onRemove={onRemoveDomain}
        removeLabel={(domain) => `Remove ${domain} from ${brand}`}
        inputLabel={`Add website for ${brand}`}
        placeholder={atCap ? `Limit of ${MAX_DOMAINS_PER_COMPETITOR} reached` : 'Add website'}
        mono
        disabled={atCap}
        variant="inline"
      >
        {unsavedSuggestions.map((domain) => (
          <SuggestedDomainChip key={domain} brand={brand} domain={domain} disabled={atCap} onAdd={() => onAddDomain(domain)} />
        ))}
      </TagInput>
      <Button variant="iconOnly" size="sm" aria-label={`Remove ${brand}`} onClick={onRemove} className="justify-self-end">
        <TrashIcon className="h-4 w-4" />
      </Button>
    </li>
  );
}

interface CompetitorTableProps {
  readonly competitors: string[];
  /** Domains that will be saved, per competitor. */
  readonly domains: CompetitorDomains;
  /** Domains "Find competitors" suggested, per competitor; saved only once picked. */
  readonly suggested: CompetitorDomains;
  readonly onDomainsChange: (domains: CompetitorDomains) => void;
  readonly onRemoveCompetitor: (brand: string) => void;
  readonly newCompetitor: string;
  readonly onNewCompetitorChange: (value: string) => void;
  readonly onAddCompetitor: () => void;
}

/**
 * One row per competitor: its name, its websites as chips with a box to add
 * more (at most `MAX_DOMAINS_PER_COMPETITOR`), suggested websites as dashed
 * chips, and a remove button. A last row adds a competitor.
 */
export function CompetitorTable({
  competitors, domains, suggested, onDomainsChange, onRemoveCompetitor, newCompetitor, onNewCompetitorChange, onAddCompetitor
}: CompetitorTableProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200">
      {competitors.length > 0 && (
        <div aria-hidden="true" className="hidden border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs font-medium uppercase tracking-wider text-gray-500 sm:grid sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_2rem] sm:gap-2">
          <span>Competitor</span>
          <span className="pl-2.5">Websites (up to {MAX_DOMAINS_PER_COMPETITOR})</span>
        </div>
      )}
      <ul aria-label="Competitors" className="divide-y divide-gray-200">
        {competitors.map((brand) => (
          <CompetitorRow
            key={brand}
            brand={brand}
            saved={domains[brand] ?? []}
            suggested={suggested[brand] ?? []}
            onAddDomain={(domain) => onDomainsChange(withCompetitorDomain(domains, brand, domain))}
            onRemoveDomain={(domain) => onDomainsChange(withoutCompetitorDomain(domains, brand, domain))}
            onRemove={() => onRemoveCompetitor(brand)}
          />
        ))}
      </ul>
      <div className={`bg-gray-50 px-4 py-3 ${competitors.length > 0 ? 'border-t border-gray-200' : ''}`}>
        {competitors.length === 0 && (
          <p className="mb-2 text-sm text-gray-600">No competitors yet. Add one here, or let Find competitors suggest some.</p>
        )}
        <TagInput
          draft={newCompetitor}
          onDraftChange={onNewCompetitorChange}
          onCommit={onAddCompetitor}
          inputId="new-competitor-brand"
          inputLabel="Add competitor"
          placeholder="Add a competitor name and press Enter"
        />
      </div>
    </div>
  );
}
