interface ExtractionOptionsProps {
  readonly includeSentiment: boolean;
  readonly includeRankingContext: boolean;
  readonly maxBrands: number;
  readonly onSentimentChange: (value: boolean) => void;
  readonly onRankingContextChange: (value: boolean) => void;
  readonly onMaxBrandsChange: (value: number) => void;
}

const CHECKBOX = 'h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-2 focus:ring-gray-900';

export const ExtractionOptions = ({
  includeSentiment,
  includeRankingContext,
  maxBrands,
  onSentimentChange,
  onRankingContextChange,
  onMaxBrandsChange,
}: ExtractionOptionsProps) => (
  <fieldset className="space-y-3">
    <legend className="mb-2 text-sm font-semibold text-gray-900">Extraction options</legend>
    <label htmlFor="brands-extraction-include-sentiment" className="flex items-center gap-3">
      <input
        id="brands-extraction-include-sentiment"
        name="brands-extraction-include-sentiment"
        type="checkbox"
        checked={includeSentiment}
        onChange={(e) => onSentimentChange(e.target.checked)}
        className={CHECKBOX}
      />
      <span className="text-sm text-gray-700">Include sentiment analysis</span>
    </label>
    <label htmlFor="brands-extraction-include-ranking-context" className="flex items-center gap-3">
      <input
        id="brands-extraction-include-ranking-context"
        name="brands-extraction-include-ranking-context"
        type="checkbox"
        checked={includeRankingContext}
        onChange={(e) => onRankingContextChange(e.target.checked)}
        className={CHECKBOX}
      />
      <span className="text-sm text-gray-700">Include ranking context</span>
    </label>
    <div className="flex items-center gap-3">
      <label htmlFor="brands-extraction-max-brands" className="text-sm text-gray-700">Max brands per response:</label>
      <input
        id="brands-extraction-max-brands"
        name="brands-extraction-max-brands"
        type="number"
        value={maxBrands}
        onChange={(e) => onMaxBrandsChange(parseInt(e.target.value, 10) || 20)}
        min={5}
        max={50}
        className="w-20 rounded-lg border border-gray-300 bg-white p-2 text-sm focus:ring-2 focus:ring-gray-900"
      />
    </div>
  </fieldset>
);
