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

export const IndustrySelector = ({
  industry,
  presets,
  industryPrompts,
  currentPreset,
  onIndustryChange,
}: IndustrySelectorProps) => (
  <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
    <h3 className="text-sm font-semibold text-gray-900 mb-3">Industry</h3>
    <select
      value={industry}
      onChange={(e) => onIndustryChange(e.target.value)}
      className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-gray-900 bg-white text-sm"
    >
      {presets && Object.entries(presets).map(([key, preset]) => (
        <option key={key} value={key}>
          {preset.name}{industryPrompts[key] ? ' (custom prompt)' : ''}
        </option>
      ))}
    </select>
    {currentPreset && (
      <div className="mt-3 text-sm text-gray-600">
        <p>{currentPreset.description}</p>
        {currentPreset.example_brands && currentPreset.example_brands.length > 0 && (
          <p className="mt-2">
            <span className="font-medium text-gray-700">Examples:</span>{' '}
            {currentPreset.example_brands.slice(0, 5).join(', ')}
          </p>
        )}
      </div>
    )}
  </div>
);
