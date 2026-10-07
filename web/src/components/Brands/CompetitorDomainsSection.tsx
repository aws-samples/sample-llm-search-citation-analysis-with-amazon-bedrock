import { useState } from 'react';
import type { CompetitorDomains } from '../../api/competitorDomainsDecoders';
import { normalizeDomain } from '../../formatting/domainIdentity';
import {
  MAX_DOMAINS_PER_COMPETITOR, competitorDomainChoices, withCompetitorDomain, withoutCompetitorDomain
} from '../../hooks/competitorDomains';

interface CompetitorDomainsSectionProps {
  readonly competitors: string[];
  /** Domains that will be saved, per competitor. */
  readonly domains: CompetitorDomains;
  /** Domains "Find Competitors" suggested, per competitor; shown unchecked until ticked. */
  readonly suggested: CompetitorDomains;
  readonly onChange: (domains: CompetitorDomains) => void;
}

interface CompetitorDomainRowProps {
  readonly brand: string;
  readonly saved: string[];
  readonly suggested: string[];
  readonly onToggle: (domain: string, checked: boolean) => void;
  readonly onAdd: (domain: string) => void;
}

function CompetitorDomainRow({
  brand, saved, suggested, onToggle, onAdd
}: CompetitorDomainRowProps) {
  const [draft, setDraft] = useState('');
  const atCap = saved.length >= MAX_DOMAINS_PER_COMPETITOR;
  const choices = competitorDomainChoices(saved, suggested);
  const add = () => {
    const domain = normalizeDomain(draft);
    if (domain === null || atCap) return;
    onAdd(domain);
    setDraft('');
  };

  return (
    <li className="py-2">
      <p className="text-sm font-medium text-amber-900 mb-1">{brand}</p>
      <div className="flex flex-wrap gap-3 mb-2">
        {choices.map((domain) => {
          const checked = saved.includes(domain);
          return (
            <label key={domain} className="inline-flex items-center gap-1.5 text-sm font-mono text-amber-800">
              <input
                type="checkbox"
                checked={checked}
                disabled={!checked && atCap}
                onChange={(e) => onToggle(domain, e.target.checked)}
                aria-label={`${domain} for ${brand}`}
                className="rounded border-amber-400 text-amber-600 focus:ring-amber-500"
              />
              {domain}
              {!checked && <span className="text-xs font-sans text-amber-600">(suggested)</span>}
            </label>
          );
        })}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          disabled={atCap}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="e.g., competitor.com"
          aria-label={`New domain for ${brand}`}
          className="flex-1 p-1.5 border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-500 bg-white text-sm"
        />
        <button
          onClick={add}
          disabled={atCap}
          aria-label={`Add domain for ${brand}`}
          className="px-3 py-1.5 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </li>
  );
}

/**
 * Each tracked competitor's website domains. Ticked domains are saved with
 * the configuration; a domain "Find Competitors" suggested stays unticked
 * until the admin confirms it. Citations of these domains count as that
 * competitor's in the citation-ownership insights.
 */
export function CompetitorDomainsSection({
  competitors, domains, suggested, onChange
}: CompetitorDomainsSectionProps) {
  return (
    <div className="bg-amber-50/50 rounded-lg p-4 border border-amber-200">
      <h3 className="text-sm font-semibold text-amber-800 mb-2">Competitor Domains</h3>
      <p className="text-xs text-amber-700 mb-3">
        Each competitor&apos;s websites, at most {MAX_DOMAINS_PER_COMPETITOR} each; subdomains count too. Reports count AI answers citing them as that competitor&apos;s.
        Domains suggested by &quot;Find Competitors&quot; are saved only once you tick them.
      </p>
      {competitors.length === 0 ? (
        <p className="text-sm text-amber-600 italic">Add competitor brands to record their domains</p>
      ) : (
        <ul className="divide-y divide-amber-100">
          {competitors.map((brand) => (
            <CompetitorDomainRow
              key={brand}
              brand={brand}
              saved={domains[brand] ?? []}
              suggested={suggested[brand] ?? []}
              onToggle={(domain, checked) => onChange(checked ? withCompetitorDomain(domains, brand, domain) : withoutCompetitorDomain(domains, brand, domain))}
              onAdd={(domain) => onChange(withCompetitorDomain(domains, brand, domain))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
