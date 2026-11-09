import type {
  IndustryPresets, IndustryPreset
} from '../../types';

interface IndustrySelectorProps {
  readonly industry: string;
  readonly presets: IndustryPresets | null;
  readonly industryPrompts: Record<string, string>;
  readonly currentPreset: IndustryPreset | undefined;
  readonly onIndustryChange: (industry: string) => void;
}

/** The industry preset (it picks the extraction prompt), as a compact labelled select with the preset's description under it. */
export const IndustrySelector = ({
  industry, presets, industryPrompts, currentPreset, onIndustryChange,
}: IndustrySelectorProps) => {
  const examples = currentPreset?.example_brands?.slice(0, 5) ?? [];
  return (
    <div className="w-full sm:w-72">
      <label htmlFor="industry-select" className="mb-1 block text-sm font-medium text-gray-700">Industry</label>
      <select
        id="industry-select"
        value={industry}
        onChange={(e) => onIndustryChange(e.target.value)}
        className="w-full rounded-lg border border-gray-300 bg-white p-2 text-sm focus:ring-2 focus:ring-gray-900"
      >
        {presets && Object.entries(presets).map(([key, preset]) => (
          <option key={key} value={key}>
            {preset.name}{industryPrompts[key] ? ' (custom prompt)' : ''}
          </option>
        ))}
      </select>
      {currentPreset && (
        <p className="mt-1.5 text-sm text-gray-500">
          <span>{currentPreset.description}</span>
          {examples.length > 0 && <> <span>e.g.</span> <span>{examples.join(', ')}</span></>}
        </p>
      )}
    </div>
  );
};
