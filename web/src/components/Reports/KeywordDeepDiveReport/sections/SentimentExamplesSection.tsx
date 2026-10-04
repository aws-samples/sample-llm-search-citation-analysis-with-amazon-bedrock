import type { BrandMentionsResponse } from '../../../../types';
import {
  ReportSection,
  pendingSectionPlaceholder,
  type SectionFetchState,
} from '../../layout';
import { SectionPlaceholder } from '../../layout/SectionPlaceholder';

interface Props extends SectionFetchState {readonly mentions: BrandMentionsResponse | null;}

interface SentimentExample {
  brand: string;
  provider: string;
  sentiment: string;
  /** The engine's own words about the brand, when extracted. */
  quote?: string;
  /** Why the extraction labelled it so; not a quote. */
  reason?: string;
  rankingContext?: string;
}

const SENTIMENT_ORDER = ['negative', 'positive', 'mixed', 'neutral'] as const;
const MAX_EXAMPLES_PER_POLARITY = 2;

/**
 * Surface representative sentiment examples — what AI engines actually said
 * about first-party brands when they ranked them. Negative examples come
 * first because those are the ones a marketer needs to act on; positive
 * examples confirm what's working and provide language to amplify.
 *
 * We pull from the per-provider `appearances` array on each first-party
 * brand so the quotes stay tied to a specific provider/rank. Examples
 * with neither a `sentiment_quote` nor a `sentiment_reason` are skipped — a
 * sentiment label with nothing to back it is not useful in a printed report.
 * The quote is the engine's own words; the reason is the extraction's
 * explanation, so it is shown as "Why: …", never as a quotation.
 */
export function SentimentExamplesSection({
  mentions, loading, error 
}: Props) {
  const pending = pendingSectionPlaceholder({
    title: 'Sentiment examples',
    loading,
    loadingMessage: 'Loading sentiment data…',
    error,
  });
  if (pending) return pending;

  if (!mentions) {
    return null;
  }

  const examples = collectExamples(mentions.aggregated.first_party_brands);

  if (examples.length === 0) {
    return (
      <ReportSection
        title="Sentiment examples"
        subtitle="No sentiment annotations were extracted from this keyword's responses."
      >
        <SectionPlaceholder
          variant="empty"
          message="Sentiment extraction may be disabled, or AI responses for this keyword may not have produced annotated mentions."
        />
      </ReportSection>
    );
  }

  return (
    <ReportSection
      title="Sentiment examples"
      subtitle="What AI engines actually said about your brands. Negatives first — those are the ones to act on."
    >
      <div className="space-y-3">
        {examples.map((example) => (
          <ExampleCard
            // Stryker disable next-line StringLiteral,LogicalOperator: React list key only; the rendered cards are identical
            key={`${example.brand}::${example.provider}::${example.sentiment}::${example.quote ?? ''}::${example.reason ?? ''}`}
            example={example}
          />
        ))}
      </div>
    </ReportSection>
  );
}

function collectExamples(brands: BrandMentionsResponse['aggregated']['first_party_brands']): SentimentExample[] {
  const grouped: Record<string, SentimentExample[]> = {};
  for (const polarity of SENTIMENT_ORDER) grouped[polarity] = [];

  for (const brand of brands) {
    for (const appearance of brand.appearances) {
      const polarity = (appearance.sentiment ?? 'neutral').toLowerCase();
      if (!appearance.sentiment_quote && !appearance.sentiment_reason) continue;
      const bucket = grouped[polarity];
      if (!bucket || bucket.length >= MAX_EXAMPLES_PER_POLARITY) continue;
      bucket.push({
        brand: brand.name,
        provider: appearance.provider,
        sentiment: polarity,
        quote: appearance.sentiment_quote,
        reason: appearance.sentiment_reason,
        rankingContext: appearance.ranking_context,
      });
    }
  }

  // Negative first, then positive, then mixed, then neutral.
  return SENTIMENT_ORDER.flatMap((polarity) => grouped[polarity]);
}

function ExampleCard({ example }: { readonly example: SentimentExample }) {
  const accent = accentClassFor(example.sentiment);

  return (
    <div className={`border ${accent} rounded-lg p-4`}>
      <div className="flex items-center gap-2 mb-2 text-xs">
        <span className="font-semibold text-gray-900 dark:text-white">
          {example.brand}
        </span>
        <span className="text-gray-500 dark:text-gray-400">
          on {example.provider}
        </span>
        <span className="px-2 py-0.5 rounded-full text-xs font-medium uppercase tracking-wide text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700">
          {example.sentiment}
        </span>
      </div>
      {example.quote && (
        <blockquote className="text-sm text-gray-800 dark:text-gray-200 italic">
          “{example.quote}”
        </blockquote>
      )}
      {example.reason && (
        <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
          Why: {example.reason}
        </p>
      )}
      {example.rankingContext && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
          Ranking context: {example.rankingContext}
        </p>
      )}
    </div>
  );
}

function accentClassFor(sentiment: string): string {
  if (sentiment === 'negative') {
    return 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20';
  }
  if (sentiment === 'positive') {
    return 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20';
  }
  return 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800';
}
