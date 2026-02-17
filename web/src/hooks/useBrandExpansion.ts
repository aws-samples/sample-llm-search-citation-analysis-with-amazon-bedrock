import { useState } from 'react';
import type {
  BrandExpansionAllResult, CompetitorDiscoveryResult 
} from '../types';

// Default result for when expansion is not available
const defaultExpansionResult: BrandExpansionAllResult = {
  existing_brands: [],
  suggestions: [],
  parent_companies: [],
  duplicates_found: [],
  notes: '',
};

const defaultCompetitorResult: CompetitorDiscoveryResult = {
  first_party_brands: [],
  competitors: [],
  notes: '',
};

export const useBrandExpansion = () => {
  const [expandingBrand, setExpandingBrand] = useState<'first_party' | 'competitor' | null>(null);
  const [expansionAllResult, setExpansionAllResult] = useState<BrandExpansionAllResult | null>(null);
  const [competitorDiscoveryResult, setCompetitorDiscoveryResult] = useState<CompetitorDiscoveryResult | null>(null);
  const [pendingExpansionBrands, setPendingExpansionBrands] = useState<string[]>([]);
  const [expansionTarget, setExpansionTarget] = useState<'first_party' | 'competitor' | null>(null);

  const handleExpandAllBrands = async (
    brands: string[], 
    brandType: 'first_party' | 'competitor',
    onExpandAllBrands?: (existingBrands: string[], brandType: 'first_party' | 'competitor') => Promise<BrandExpansionAllResult>
  ): Promise<BrandExpansionAllResult> => {
    if (!onExpandAllBrands || brands.length === 0) return defaultExpansionResult;
    setExpandingBrand(brandType);
    setExpansionTarget(brandType);
    setExpansionAllResult(null);
    setCompetitorDiscoveryResult(null);
    try {
      const result = await onExpandAllBrands(brands, brandType);
      setExpansionAllResult(result);
      setPendingExpansionBrands([]);
      return result;
    } catch (err) {
      console.error('Error expanding all brands:', err);
      return defaultExpansionResult;
    } finally {
      setExpandingBrand(null);
    }
  };

  const handleFindCompetitors = async (
    firstPartyBrands: string[],
    competitorBrands: string[],
    onFindCompetitors?: (firstPartyBrands: string[], existingCompetitors?: string[]) => Promise<CompetitorDiscoveryResult>
  ): Promise<CompetitorDiscoveryResult> => {
    if (!onFindCompetitors || firstPartyBrands.length === 0) return defaultCompetitorResult;
    setExpandingBrand('competitor');
    setExpansionTarget('competitor');
    setExpansionAllResult(null);
    setCompetitorDiscoveryResult(null);
    try {
      const result = await onFindCompetitors(firstPartyBrands, competitorBrands);
      setCompetitorDiscoveryResult(result);
      setPendingExpansionBrands([]);
      return result;
    } catch (err) {
      console.error('Error finding competitors:', err);
      return defaultCompetitorResult;
    } finally {
      setExpandingBrand(null);
    }
  };

  const cancelExpansion = () => {
    setExpansionAllResult(null);
    setCompetitorDiscoveryResult(null);
    setPendingExpansionBrands([]);
    setExpansionTarget(null);
  };

  const togglePendingBrand = (brand: string) => {
    if (pendingExpansionBrands.includes(brand)) {
      setPendingExpansionBrands(pendingExpansionBrands.filter(b => b !== brand));
    } else {
      setPendingExpansionBrands([...pendingExpansionBrands, brand]);
    }
  };

  return {
    expandingBrand,
    expansionAllResult,
    competitorDiscoveryResult,
    pendingExpansionBrands,
    expansionTarget,
    handleExpandAllBrands,
    handleFindCompetitors,
    cancelExpansion,
    togglePendingBrand,
  };
};
