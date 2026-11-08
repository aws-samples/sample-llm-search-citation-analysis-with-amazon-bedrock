import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import { SeoFeatureConstruct } from './seo-feature';
import { stringKey } from './tables';

export const BACKLINK_SNAPSHOTS_TABLE_NAME = 'CitationAnalysis-SeoBacklinkSnapshots';
export const BACKLINK_SNAPSHOTS_STATE_MACHINE_NAME = 'CitationAnalysis-SeoBacklinkSnapshots';

/** The jobs function stops starting DataForSEO calls 13 minutes in; its own timeout is 15. */
const SNAPSHOT_TASK_TIMEOUT = cdk.Duration.minutes(15);
const SNAPSHOT_RUN_TIMEOUT = cdk.Duration.minutes(20);

/**
 * Backlinks: the live explorer routes (summary, history, links, referring
 * domains, top pages; paid, cached 6 h in SeoCache) and the weekly snapshots
 * of the brand's own and its competitors' domains.
 *
 * Snapshots live in `CitationAnalysis-SeoBacklinkSnapshots` (pk `domain`,
 * sk `snapshot_at`, kept, never expired). One state machine with one task
 * runs the jobs step `backlinks.snapshot_all`, started by the Admin route
 * "snapshot now" or by a Schedule (Operations > Schedule, kind "Backlink
 * snapshots": an EventBridge Scheduler schedule an Admin creates in the main
 * stack); nothing runs while no schedule exists. The task is never retried:
 * every DataForSEO summary it sends is billed, even when the call then fails.
 */
export class SeoBacklinks extends SeoFeatureConstruct {
  protected build(): void {
    // One item per domain and snapshot time (ISO-8601, so the sort key orders them in time).
    this.sharedTable('SnapshotsTable', 'DYNAMODB_TABLE_SEO_BACKLINK_SNAPSHOTS', {
      tableName: BACKLINK_SNAPSHOTS_TABLE_NAME,
      partitionKey: stringKey('domain'),
      sortKey: stringKey('snapshot_at'),
    });

    const { router } = this.props;
    const snapshotStateMachine = this.snapshotRun();
    router.addEnvironment('SEO_BACKLINK_SNAPSHOTS_STATE_MACHINE_ARN', snapshotStateMachine.stateMachineArn);
    snapshotStateMachine.grant(router, 'states:StartExecution', 'states:ListExecutions');


    this.serve(
      ['backlinks/overview', ['POST']],
      ['backlinks/rows', ['POST']],
      ['backlinks/referring-domains', ['POST']],
      ['backlinks/top-pages', ['POST']],
      ['backlinks/snapshots', ['GET', 'POST']],
    );
  }

  /** One task, no retry: the step itself skips domains snapshotted in the last 20 hours. */
  private snapshotRun(): stepfunctions.StateMachine {
    const snapshotAll = this.jobsTask('SnapshotAll', {
      step: 'backlinks.snapshot_all',
    }, { outputPath: '$.Payload', retryOnServiceExceptions: false, timeout: SNAPSHOT_TASK_TIMEOUT });
    const role = new iam.Role(this, 'StateMachineRole', {
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      description: 'Backlink snapshots state machine: invoke the SEO jobs function and write its logs',
    });
    return this.stateMachine({
      id: 'SnapshotStateMachine',
      stateMachineName: BACKLINK_SNAPSHOTS_STATE_MACHINE_NAME,
      definition: snapshotAll,
      timeout: SNAPSHOT_RUN_TIMEOUT,
      role,
    });
  }
}
