import { Construct } from 'constructs';
import { SeoBacklinks } from './constructs/seo-backlinks';
import { SeoDomain } from './constructs/seo-domain';
import type { SeoFeature, SeoFeatureProps } from './constructs/seo-feature';
import { SeoLocal } from './constructs/seo-local';
import { SeoPerformance } from './constructs/seo-performance';
import { SeoRankTracking } from './constructs/seo-rank-tracking';
import { SeoSiteAudit } from './constructs/seo-site-audit';

/**
 * Every SEO feature of `CitationAnalysisSeoStack`, in the order the stack
 * builds them. Each is a construct in `lib/constructs/seo-<feature>.ts`.
 */
export function seoFeatures(scope: Construct, props: SeoFeatureProps): SeoFeature[] {
  return [
    new SeoRankTracking(scope, 'RankTracking', props),
    new SeoDomain(scope, 'Domain', props),
    new SeoBacklinks(scope, 'Backlinks', props),
    new SeoLocal(scope, 'Local', props),
    new SeoSiteAudit(scope, 'SiteAudit', props),
    new SeoPerformance(scope, 'Performance', props),
  ];
}
