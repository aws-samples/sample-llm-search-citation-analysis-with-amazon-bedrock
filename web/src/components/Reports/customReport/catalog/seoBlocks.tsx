import type { ComponentType } from 'react';
import { SeoGeoQuadrantSection } from '../../SeoGeoReport/sections/SeoGeoQuadrantSection';
import { SeoGeoTableSection } from '../../SeoGeoReport/sections/SeoGeoTableSection';
import type { SeoGeoSectionProps } from '../../SeoGeoReport/sections/seoGeoGate';
import type { DataBlockDefinition } from './catalogTypes';

/**
 * Blocks drawn from the SEO source (`GET /api/seo/seo-geo`): the keywords
 * per SEO vs GEO quadrant and the full keyword table of the SEO vs GEO
 * report, for every keyword or a keyword group of the header market. Each
 * says so when the SEO stack is not deployed.
 */

/** `[type, label, description, section]`; the type is what saved reports store, so it never changes. */
type SeoBlockRow = readonly [string, string, string, ComponentType<SeoGeoSectionProps>];

const SEO_BLOCK_ROWS: readonly SeoBlockRow[] = [
  [
    'seo_geo_quadrants',
    'Keywords per quadrant',
    'How many keywords are strong on Google and in the AI answers, strong on one only, or on neither.',
    SeoGeoQuadrantSection,
  ],
  [
    'seo_geo_table',
    'Keyword table',
    'Every keyword with its search volume, organic position, AI Overview, AI mention rate, citation overlap and quadrant.',
    SeoGeoTableSection,
  ],
];

export const SEO_BLOCKS: readonly DataBlockDefinition[] = SEO_BLOCK_ROWS.map(([type, label, description, section]): DataBlockDefinition => {
  const Section = section;
  return {
    type,
    category: 'seo',
    label,
    description,
    sources: ['seo'],
    scopes: ['all', 'group'],
    render: ({ seo }) => seo && <Section state={seo} />,
  };
});
