import { useState } from 'react';
import type { CompetitorDiscoveryResult } from '../../types';
import type { BrandListSectionProps } from './brandListSection';
import type { CompetitorDomains } from '../../api/competitorDomainsDecoders';
import { MAX_DOMAINS_PER_COMPETITOR } from '../../hooks/competitorDomains';
import {
  BOLT_PATHS, SEARCH_PATHS
} from '../ui/iconPaths';
import { BrandExpansionPanel } from './BrandExpansionPanel';
import { CompetitorDiscoveryPanel } from './CompetitorDiscoveryPanel';
import { CompetitorTable } from './CompetitorTable';
import {
  ConfigSection, SuggestButton
} from './ConfigSection';

interface CompetitorBrandsSectionProps extends BrandListSectionProps {
  readonly domains: CompetitorDomains;
  readonly suggestedDomains: CompetitorDomains;
  /** A suggestion request for the competitor list is running. */
  readonly busy: boolean;
  readonly discoveryResult: CompetitorDiscoveryResult | null;
  readonly hasFirstPartyBrands: boolean;
  readonly canFindCompetitors: boolean;
  readonly brandExists: (brand: string, list: string[]) => boolean;
  readonly onDomainsChange: (domains: CompetitorDomains) => void;
  readonly onFindCompetitors: () => void;
}

type SuggestAction = 'find' | 'expand';

function describeCompetitors(hasFirstPartyBrands: boolean, canFind: boolean): string {
  const base = `The brands you compete with and their websites (up to ${MAX_DOMAINS_PER_COMPETITOR} each). Answers that link to these websites count as that competitor's citations.`;
  return canFind && !hasFirstPartyBrands ? `${base} Add your brand names first to get competitor suggestions.` : base;
}

interface CompetitorActionsProps {
  readonly brandCount: number;
  readonly busy: boolean;
  readonly lastAction: SuggestAction | null;
  readonly hasFirstPartyBrands: boolean;
  readonly canExpand: boolean;
  readonly canFindCompetitors: boolean;
  readonly onFind: () => void;
  readonly onExpand: () => void;
}

/** "Find competitors" and "Suggest sub-brands"; the one whose request runs shows the spinner. */
function CompetitorActions({
  brandCount, busy, lastAction, hasFirstPartyBrands, canExpand, canFindCompetitors, onFind, onExpand
}: CompetitorActionsProps) {
  const showExpand = canExpand && brandCount > 0;
  if (!canFindCompetitors && !showExpand) return null;
  return (
    <>
      {canFindCompetitors && (
        <SuggestButton label="Find competitors" busyLabel="Finding…" busy={busy && lastAction === 'find'} disabled={busy || !hasFirstPartyBrands} iconPaths={SEARCH_PATHS} onClick={onFind} />
      )}
      {showExpand && (
        <SuggestButton label="Suggest sub-brands" busyLabel="Suggesting…" busy={busy && lastAction === 'expand'} disabled={busy} iconPaths={BOLT_PATHS} onClick={onExpand} />
      )}
    </>
  );
}

/**
 * "Competitors": the competitor list as a table (name, websites, remove),
 * with "Find competitors" and "Suggest sub-brands" as secondary actions whose
 * suggestions open above the table.
 */
export function CompetitorBrandsSection(props: CompetitorBrandsSectionProps) {
  const {
    brands, busy, hasFirstPartyBrands, canExpand, canFindCompetitors, expansionResult, discoveryResult,
  } = props;
  const [lastAction, setLastAction] = useState<SuggestAction | null>(null);
  const run = (action: SuggestAction, request: () => void) => { setLastAction(action); request(); };

  return (
    <ConfigSection
      title={<>Competitors{brands.length > 0 && <span className="text-sm font-normal text-gray-500">{brands.length}</span>}</>}
      description={describeCompetitors(hasFirstPartyBrands, canFindCompetitors)}
      actions={<CompetitorActions brandCount={brands.length} busy={busy} lastAction={lastAction} hasFirstPartyBrands={hasFirstPartyBrands} canExpand={canExpand} canFindCompetitors={canFindCompetitors} onFind={() => run('find', props.onFindCompetitors)} onExpand={() => run('expand', props.onExpandAll)} />}
    >
      {discoveryResult && (
        <CompetitorDiscoveryPanel result={discoveryResult} existingCompetitors={brands} pendingBrands={props.pendingBrands} brandExists={props.brandExists} onToggleBrand={props.onTogglePending} onAccept={props.onAcceptExpansion} onCancel={props.onCancelExpansion} />
      )}
      {expansionResult && (
        <BrandExpansionPanel result={expansionResult} target="competitor" pendingBrands={props.pendingBrands} onToggleBrand={props.onTogglePending} onAccept={props.onAcceptExpansion} onCancel={props.onCancelExpansion} />
      )}
      <CompetitorTable
        competitors={brands}
        domains={props.domains}
        suggested={props.suggestedDomains}
        onDomainsChange={props.onDomainsChange}
        onRemoveCompetitor={props.onRemoveBrand}
        newCompetitor={props.newBrand}
        onNewCompetitorChange={props.onNewBrandChange}
        onAddCompetitor={props.onAddBrand}
      />
    </ConfigSection>
  );
}
