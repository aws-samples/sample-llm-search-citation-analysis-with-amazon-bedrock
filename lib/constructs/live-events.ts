import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

/**
 * Names the live events (AWS AppSync Events, `CitationAnalysisEventsStack`) share with the stacks around them.
 * Kept out of the stack modules so the main, events and API stacks can all import them without an import cycle.
 */

/** The analysis workflow; its role policies format ARNs from the name to avoid a self-reference. */
export const WORKFLOW_STATE_MACHINE_NAME = 'CitationAnalysis-Workflow';
/** The keyword research state machine. */
export const RESEARCH_STATE_MACHINE_NAME = 'CitationAnalysis-KeywordResearch';
/** The distributed scope snapshot and citation rollup build. */
export const SCOPE_SNAPSHOT_BUILD_NAME = 'CitationAnalysis-ScopeSnapshotBuild';

/**
 * The deployment channel topic each state machine's Step Functions status changes go to
 * (`lambda/live-events/live_channel_routes.py`). The export state machine is not here: an export is its owner's
 * only, and the export worker announces it on the owner's channel.
 */
export const STATE_MACHINE_TOPICS: Readonly<Record<string, string>> = {
  [WORKFLOW_STATE_MACHINE_NAME]: 'runs',
  [RESEARCH_STATE_MACHINE_NAME]: 'research',
  [SCOPE_SNAPSHOT_BUILD_NAME]: 'snapshots',
};

/** Every source the platform's own change events use (`lambda/shared/change_events.py` `SOURCE_PREFIX`). */
export const CHANGE_EVENT_SOURCE_PREFIX = 'citation-analysis.';

/**
 * SSM parameters the events stack writes and the API stack reads into `config.json`: the Event API's HTTP and
 * real-time domains, fixed for the life of the API.
 */
export const LIVE_EVENTS_PARAMETERS = {
  httpDomain: '/citation-analysis/live-events-http-domain',
  realtimeDomain: '/citation-analysis/live-events-realtime-domain',
} as const;

/**
 * The source of each kind of change event, by area: `lambda/shared/change_events.py`, and `viewJobs` for the
 * `view-job.finished` event of `lambda/shared/view_job_events.py`, which the export state machine also resumes on.
 */
export const CHANGE_EVENT_SOURCES = {
  runs: 'citation-analysis.runs',
  research: 'citation-analysis.research',
  contentStudio: 'citation-analysis.content-studio',
  insights: 'citation-analysis.insights',
  viewJobs: 'citation-analysis.view-jobs',
  snapshots: 'citation-analysis.snapshots',
  alerts: 'citation-analysis.alerts',
  exports: 'citation-analysis.exports',
  seo: 'citation-analysis.seo',
} as const;

type ChangeEventArea = keyof typeof CHANGE_EVENT_SOURCES;

/** The workflow's per-keyword progress event (`RUN_KEYWORD_FINISHED` in `lambda/shared/change_events.py`). */
export const RUN_KEYWORD_FINISHED = { source: CHANGE_EVENT_SOURCES.runs, detailType: 'run.keyword.finished' } as const;

/**
 * Lets `grantee` put change events on the default bus under `areas`' sources only (`events:source`), so a function
 * can announce its own changes and nobody else's (tenet 6). No other bus, no other source.
 */
export function allowChangeEvents(grantee: iam.IGrantable, scope: Construct, areas: readonly ChangeEventArea[]): void {
  grantee.grantPrincipal.addToPrincipalPolicy(new iam.PolicyStatement({
    actions: ['events:PutEvents'],
    resources: [cdk.Stack.of(scope).formatArn({ service: 'events', resource: 'event-bus', resourceName: 'default' })],
    conditions: { StringEquals: { 'events:source': areas.map((area) => CHANGE_EVENT_SOURCES[area]) } },
  }));
}
