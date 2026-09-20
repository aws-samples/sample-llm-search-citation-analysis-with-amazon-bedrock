import type { BrandConfig } from '../types';
import { mockBrandConfig } from './useBrandConfig-fixtures';

export const EMPTY_INDUSTRY_CONFIG = {
  ...mockBrandConfig,
  industry: '',
} satisfies BrandConfig;

export const OMITTED_INDUSTRY_CONFIG = {
  tracked_brands: mockBrandConfig.tracked_brands,
  extract_brands: mockBrandConfig.extract_brands,
} satisfies Partial<BrandConfig>;
