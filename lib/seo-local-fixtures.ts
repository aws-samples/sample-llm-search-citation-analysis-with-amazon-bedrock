import { extractApiAuthSnapshots, methodRouteLabels, sortedUnique } from './citation-analysis-stack-fixtures';
import { SEO_LOCAL_JOB_STATE_MACHINE_NAME } from './constructs/seo-local';
import {
  featureResourceIds,
  synthesizeRoutedJobSnapshot,
  synthesizeSeoFeatureTemplate,
  type RoutedJobSnapshot,
} from './seo-feature-fixtures';

const LOCAL_ROUTE = /^[A-Z]+ \/api\/seo\/local\//;
/** Construct id of the local SEO feature in the stack: its resources' logical ids start with it. */
const LOCAL_CONSTRUCT_ID = 'Local';

/** The SEO stack as synthesized, read for the local SEO feature; the job state machine's fields come from `RoutedJobSnapshot`. */
interface SeoLocalSnapshot extends RoutedJobSnapshot {
  /** `"<VERB> <path>"` of every local route (preflights excluded), sorted. */
  routes: string[];
  /** Logical ids of the tables the feature itself defines. */
  ownTableIds: string[];
}

export function synthesizeSeoLocalSnapshot(): SeoLocalSnapshot {
  const template = synthesizeSeoFeatureTemplate();
  return {
    ...synthesizeRoutedJobSnapshot(template, SEO_LOCAL_JOB_STATE_MACHINE_NAME),
    routes: sortedUnique(methodRouteLabels(extractApiAuthSnapshots(template)).filter((label) => LOCAL_ROUTE.test(label))),
    ownTableIds: featureResourceIds(template, LOCAL_CONSTRUCT_ID, 'AWS::DynamoDB::Table'),
  };
}
