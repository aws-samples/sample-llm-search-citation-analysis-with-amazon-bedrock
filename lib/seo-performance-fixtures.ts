import { extractApiAuthSnapshots, methodRouteLabels, sortedUnique } from './citation-analysis-stack-fixtures';
import { SEO_LIGHTHOUSE_STATE_MACHINE_NAME } from './constructs/seo-performance';
import {
  featureResourceIds,
  synthesizeRoutedJobSnapshot,
  synthesizeSeoFeatureTemplate,
  type RoutedJobSnapshot,
} from './seo-feature-fixtures';

const PERFORMANCE_ROUTE = /^[A-Z]+ \/api\/seo\/(lighthouse|indexnow)(\/|$)/;
/** Construct id of the performance feature in the stack: its resources' logical ids start with it. */
const PERFORMANCE_CONSTRUCT_ID = 'Performance';

/** The SEO stack as synthesized, read for the page performance feature; the Lighthouse state machine's fields come from `RoutedJobSnapshot`. */
interface SeoPerformanceSnapshot extends RoutedJobSnapshot {
  /** `"<VERB> <path>"` of every Lighthouse and IndexNow route (preflights excluded), sorted. */
  routes: string[];
  /** Authorization type of each of those methods. */
  authorizationTypes: string[];
  /** Logical ids of the tables and functions the feature itself defines. */
  ownResourceIds: string[];
}

export function synthesizeSeoPerformanceSnapshot(): SeoPerformanceSnapshot {
  const template = synthesizeSeoFeatureTemplate();
  const performanceMethods = extractApiAuthSnapshots(template)
    .filter((method) => PERFORMANCE_ROUTE.test(`${method.httpMethod} ${method.path}`));
  return {
    ...synthesizeRoutedJobSnapshot(template, SEO_LIGHTHOUSE_STATE_MACHINE_NAME),
    routes: sortedUnique(methodRouteLabels(performanceMethods)),
    authorizationTypes: sortedUnique(performanceMethods.map((method) => method.authorizationType)),
    ownResourceIds: ['AWS::DynamoDB::Table', 'AWS::Lambda::Function']
      .flatMap((type) => featureResourceIds(template, PERFORMANCE_CONSTRUCT_ID, type)),
  };
}
