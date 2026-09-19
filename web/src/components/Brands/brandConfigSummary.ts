import type {
  BrandConfig, IndustryPresets 
} from '../../types';

/**
 * The industry a brand config tracks, as shown in the Brand Mentions header
 * and the Settings tab badge: the preset's display name, the raw key when the
 * presets do not know it, or a placeholder before anything is configured.
 */
export function describeIndustry(config: BrandConfig | null, presets: IndustryPresets | null): string {
  if (!config?.industry) return 'Not configured';
  return presets?.[config.industry]?.name ?? config.industry;
}

/** How many brands a config tracks in one list; zero without a config. */
export function countTrackedBrands(config: BrandConfig | null, list: 'first_party' | 'competitors'): number {
  return config?.tracked_brands?.[list]?.length ?? 0;
}
