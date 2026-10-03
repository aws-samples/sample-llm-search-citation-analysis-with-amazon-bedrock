import { DEFAULT_CONFIG } from '../../../constants/brandConfigDefaults';
import { buildBrandConfigHookResult } from '../../Settings/SettingsView-fixtures';
import {
  useReportSources, type ReportSources
} from './reportSources';

const SOURCE_NAMES = ['scope', 'overview', 'groupKpis', 'competitor', 'contentPlan', 'deepDive'] as const satisfies readonly (keyof ReportSources)[];

/** Lists the sources its provider mounted, by name. */
export function ReportSourcesProbe() {
  const sources = useReportSources();
  return <p>{SOURCE_NAMES.filter((name) => sources[name] !== null).join(', ')}</p>;
}

/** Shows the competitor the competitor source picked. */
export function BrandConfigProbe() {
  const { competitor } = useReportSources();
  return <p>{competitor?.selected ?? 'none'}</p>;
}

/** `useBrandConfig()` once loaded with `competitors` tracked. */
export function mockBrandConfigWith(competitors: string[]) {
  return buildBrandConfigHookResult({
    config: {
      ...DEFAULT_CONFIG,
      tracked_brands: {
        first_party: ['MyHotel'],
        competitors,
      },
    },
  });
}
