import type {
  AggregatedBrand, BrandMentionsResponse 
} from '../../../../types';
import {
  ReportSection,
  ReportSectionPlaceholder,
  ReportTable,
  type ReportTableColumn,
  gateSection,
} from '../../layout';

interface Props {
  readonly mentions: BrandMentionsResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * Per-provider ranking breakdown for first-party brands. Shows where each AI
 * engine places your brand and where it does not appear at all (a "—" cell
 * is more actionable than a missing row, because it surfaces invisibility).
 *
 * If first-party brands aren't configured, the section explains why nothing
 * is shown rather than rendering a confusing empty table.
 */
export function ProviderDeltaSection({
  mentions, loading, error 
}: Props) {
  const gate = gateSection({
    title: 'Provider differences',
    loading,
    loadingMessage: 'Loading provider data…',
    error,
    value: mentions,
  });
  if (!gate.ready) return gate.placeholder;

  const firstParty = gate.value.aggregated.first_party_brands;
  if (firstParty.length === 0) {
    return (
      <ReportSectionPlaceholder
        title="Provider differences"
        variant="empty"
        message="No first-party brand mentions for this keyword. Either the brand isn't appearing in any AI response, or no first-party brands are configured."
      />
    );
  }

  // Stable provider list across all first-party brands to anchor the columns.
  const providers = Array.from(
    new Set(firstParty.flatMap((brand) => brand.providers)),
  ).sort((a, b) => a.localeCompare(b));

  return (
    <ReportSection
      title="Provider differences"
      subtitle="Where each AI engine ranks your first-party brands."
    >
      <ReportTable
        columns={providerColumns(providers)}
        rows={firstParty}
        rowKey={(brand) => brand.name}
      />
    </ReportSection>
  );
}

function providerColumns(
  providers: ReadonlyArray<string>,
): ReadonlyArray<ReportTableColumn<AggregatedBrand>> {
  return [
    {
      header: 'Brand',
      cellClassName: 'font-medium',
      render: (brand) => brand.name,
    },
    ...providers.map((provider): ReportTableColumn<AggregatedBrand> => ({
      header: provider,
      render: (brand) => rankOn(brand, provider),
    })),
    {
      header: 'Best rank',
      cellClassName: 'font-medium',
      render: (brand) => `#${brand.best_rank}`,
    },
  ];
}

function rankOn(brand: AggregatedBrand, provider: string): string {
  const appearance = brand.appearances.find((a) => a.provider === provider);
  return appearance ? `#${appearance.rank}` : '—';
}
