interface ExtractionOptionsProps {
  readonly includeSentiment: boolean;
  readonly includeRankingContext: boolean;
  readonly maxBrands: number;
  readonly onSentimentChange: (value: boolean) => void;
  readonly onRankingContextChange: (value: boolean) => void;
  readonly onMaxBrandsChange: (value: number) => void;
}

export const ExtractionOptions = ({
  includeSentiment,
  includeRankingContext,
  maxBrands,
  onSentimentChange,
  onRankingContextChange,
  onMaxBrandsChange,
}: ExtractionOptionsProps) => (
  <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
    <h3 className="text-sm font-semibold text-gray-900 mb-3">Extraction Options</h3>
    <div className="space-y-3">
      <label
        htmlFor="brands-extraction-include-sentiment"
        className="flex items-center gap-3"
      >
        <input
          id="brands-extraction-include-sentiment"
          name="brands-extraction-include-sentiment"
          type="checkbox"
          checked={includeSentiment}
          onChange={(e) => onSentimentChange(e.target.checked)}
          className="w-4 h-4 text-gray-900 rounded border-gray-300"
        />
        <span className="text-sm text-gray-700">Include sentiment analysis</span>
      </label>
      <label
        htmlFor="brands-extraction-include-ranking-context"
        className="flex items-center gap-3"
      >
        <input
          id="brands-extraction-include-ranking-context"
          name="brands-extraction-include-ranking-context"
          type="checkbox"
          checked={includeRankingContext}
          onChange={(e) => onRankingContextChange(e.target.checked)}
          className="w-4 h-4 text-gray-900 rounded border-gray-300"
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
          className="w-20 p-2 border border-gray-200 rounded-lg bg-white text-sm"
        />
      </div>
    </div>
  </div>
);
