import { useState } from 'react';
import type {
  AggregatedBrand, ProviderBrandData 
} from '../../types';
import { ProviderResponseCard } from './ProviderResponseCard';

interface ProviderResponsesTabProps {
  brand: AggregatedBrand;
  providerData: ProviderBrandData[];
  keyword: string;
}

export const ProviderResponsesTab = ({
  brand, providerData, keyword 
}: ProviderResponsesTabProps) => {
  const [selectedProvider, setSelectedProvider] = useState<string | 'ALL'>('ALL');

  // Filter to only show providers that mentioned this brand
  const relevantProviders = providerData.filter((p) => 
    p.brands.some((b) => b.name.toLowerCase() === brand.name.toLowerCase())
  );

  if (relevantProviders.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-lg">No responses available for this brand</p>
      </div>
    );
  }

  const showAll = selectedProvider === 'ALL';
  const currentProvider = relevantProviders.find((p) => p.provider === selectedProvider);

  return (
    <div className="space-y-4">
      {/* Provider Selector */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setSelectedProvider('ALL')}
          className={`px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            selectedProvider === 'ALL'
              ? 'bg-green-500 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          ALL ({relevantProviders.length})
        </button>
        {relevantProviders.map((provider) => (
          <button
            key={provider.provider}
            onClick={() => setSelectedProvider(provider.provider)}
            className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
              selectedProvider === provider.provider
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {provider.provider.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Response Cards */}
      {showAll ? (
        <div className="space-y-6">
          {relevantProviders.map((provider) => (
            <ProviderResponseCard
              key={provider.provider}
              provider={provider}
              brand={brand}
              keyword={keyword}
            />
          ))}
        </div>
      ) : (
        currentProvider && (
          <ProviderResponseCard
            provider={currentProvider}
            brand={brand}
            keyword={keyword}
          />
        )
      )}
    </div>
  );
};
