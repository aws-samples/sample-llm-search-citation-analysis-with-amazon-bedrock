import type { BrandListSectionProps } from './brandListSection';
import { BOLT_PATHS } from '../ui/iconPaths';
import { BrandExpansionPanel } from './BrandExpansionPanel';
import {
  ConfigSection, SuggestButton
} from './ConfigSection';
import { TagInput } from './TagInput';

const FIELD_LABEL = 'mb-1 block text-sm font-medium text-gray-700';
const DOMAINS_HELP_ID = 'first-party-domains-help';

interface FirstPartyBrandsSectionProps extends BrandListSectionProps {
  readonly domains: string[];
  readonly newDomain: string;
  readonly expanding: boolean;
  readonly onNewDomainChange: (value: string) => void;
  readonly onAddDomain: () => void;
  readonly onRemoveDomain: (domain: string) => void;
}

/**
 * "Your brand": the first-party brand names and the owned websites, each a
 * tag input, with "Suggest sub-brands" and its suggestions above them.
 */
export function FirstPartyBrandsSection(props: FirstPartyBrandsSectionProps) {
  const {
    brands, domains, expanding, expansionResult, canExpand,
  } = props;

  return (
    <ConfigSection
      title={<><span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-violet-600" />Your brand</>}
      description="The names and websites that count as you. An answer that names one of these brands is a mention; a link to one of these websites is a citation."
      actions={canExpand && brands.length > 0 && (
        <SuggestButton label="Suggest sub-brands" busyLabel="Suggesting…" busy={expanding} disabled={expanding} iconPaths={BOLT_PATHS} onClick={props.onExpandAll} />
      )}
    >
      {expansionResult && (
        <BrandExpansionPanel result={expansionResult} target="first_party" pendingBrands={props.pendingBrands} onToggleBrand={props.onTogglePending} onAccept={props.onAcceptExpansion} onCancel={props.onCancelExpansion} />
      )}
      <div>
        <label htmlFor="new-first-party-brand" className={FIELD_LABEL}>Brand names</label>
        <TagInput
          items={brands}
          draft={props.newBrand}
          onDraftChange={props.onNewBrandChange}
          onCommit={props.onAddBrand}
          onRemove={props.onRemoveBrand}
          removeLabel={(brand) => `Remove ${brand}`}
          inputId="new-first-party-brand"
          inputLabel="Add brand name"
          placeholder={brands.length === 0 ? 'Type your brand name and press Enter' : 'Add brand name'}
          tone="brand"
        />
      </div>
      <div>
        <label htmlFor="new-first-party-domain" className={FIELD_LABEL}>Websites</label>
        <TagInput
          items={domains}
          draft={props.newDomain}
          onDraftChange={props.onNewDomainChange}
          onCommit={props.onAddDomain}
          onRemove={props.onRemoveDomain}
          removeLabel={(domain) => `Remove ${domain}`}
          inputId="new-first-party-domain"
          inputLabel="Add website"
          placeholder="example.com"
          tone="brand"
          mono
          describedBy={DOMAINS_HELP_ID}
        />
        <p id={DOMAINS_HELP_ID} className="mt-1.5 text-sm text-gray-500">
          {domains.length === 0
            ? 'No websites yet: citation rate and citation share stay empty, and Citation Gaps matches by brand name only.'
            : 'Subdomains count too. Links to these sites are left out of Citation Gaps.'}
        </p>
      </div>
    </ConfigSection>
  );
}
