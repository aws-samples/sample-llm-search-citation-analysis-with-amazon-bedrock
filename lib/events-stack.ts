import * as cdk from 'aws-cdk-lib';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { DASHBOARD_API_PARAMETERS } from './api-stack';
import { pythonFunction } from './constructs/api-functions';
import {
  CHANGE_EVENT_SOURCE_PREFIX, LIVE_EVENTS_PARAMETERS, STATE_MACHINE_TOPICS
} from './constructs/live-events';
import { lambdaServiceRole } from './constructs/permissions';
import { lambdaSourceCode } from './constructs/python-layer';

/** The relay Lambda's fixed name (`lambda/live-events/handler.py`). */
export const LIVE_EVENTS_RELAY_FUNCTION_NAME = 'CitationAnalysis-LiveEventsRelay';
/** Channels every signed-in user of the deployment may subscribe to: `/deployment/<topic>`. */
export const DEPLOYMENT_NAMESPACE = 'deployment';
/** Channels only one user may subscribe to: `/user/<their Cognito sub>/<topic>`. */
export const USER_NAMESPACE = 'user';

/**
 * The `user` namespace's subscribe handler (APPSYNC_JS): the channel's second segment must be the caller's own
 * Cognito `sub`. A wildcard (`/user/*`) or anyone else's sub is refused, so a user hears only their own channel.
 */
export const OWN_CHANNEL_ONLY_HANDLER = `import { util } from '@aws-appsync/utils';

export function onSubscribe(ctx) {
  const owner = ctx.info.channel.segments[1];
  if (!ctx.identity || !ctx.identity.sub || owner !== ctx.identity.sub) {
    util.unauthorized();
  }
}
`;

/**
 * Live events (TENETS.md tenet 8): the AWS AppSync Events API the dashboard subscribes to, and the relay that
 * forwards state-change events from the default EventBridge bus to its channels. Its own stack because the main
 * stack is near CloudFormation's 500-resource limit, and because it holds no data: removing it only stops the push,
 * every state stays readable through REST and MCP.
 *
 * - Clients connect and subscribe with their Cognito ID token (user pool from the `/citation-analysis/user-pool-id`
 *   SSM parameter the main stack writes); only the relay publishes, signed with IAM.
 * - `/deployment/<topic>`: state every signed-in user may read through the API. `/user/<sub>/<topic>`: state only
 *   its owner may read (exports); `OWN_CHANNEL_ONLY_HANDLER` refuses anyone else.
 * - Paid per message and connection minute: nothing runs or is billed while no event happens and no dashboard is
 *   open (tenet 7).
 *
 * It writes the API's HTTP and real-time domains to SSM (`LIVE_EVENTS_PARAMETERS`); the API stack puts them in
 * `config.json`, so the dashboard finds them at run time.
 */
export class CitationAnalysisEventsStack extends cdk.Stack {
  public readonly api: appsync.EventApi;
  public readonly relay: lambda.Function;

  constructor(scope: Construct, id: string, props: cdk.StackProps = {}) {
    super(scope, id, props);
    const userPoolId = ssm.StringParameter.valueForStringParameter(this, DASHBOARD_API_PARAMETERS.userPoolId);
    const userPool = cognito.UserPool.fromUserPoolId(this, 'UserPool', userPoolId);

    this.api = new appsync.EventApi(this, 'LiveEventsApi', {
      apiName: 'CitationAnalysis-LiveEvents',
      authorizationConfig: {
        authProviders: [
          { authorizationType: appsync.AppSyncAuthorizationType.USER_POOL, cognitoConfig: { userPool } },
          { authorizationType: appsync.AppSyncAuthorizationType.IAM },
        ],
        connectionAuthModeTypes: [appsync.AppSyncAuthorizationType.USER_POOL],
        defaultPublishAuthModeTypes: [appsync.AppSyncAuthorizationType.IAM],
        defaultSubscribeAuthModeTypes: [appsync.AppSyncAuthorizationType.USER_POOL],
      },
    });
    // Both namespaces say it themselves, whatever the API defaults become: signed-in users subscribe, only IAM
    // (the relay) publishes, so no browser can publish to a channel.
    const namespaceAuth: appsync.NamespaceAuthConfig = {
      publishAuthModeTypes: [appsync.AppSyncAuthorizationType.IAM],
      subscribeAuthModeTypes: [appsync.AppSyncAuthorizationType.USER_POOL],
    };
    const deployment = this.api.addChannelNamespace('DeploymentNamespace', {
      channelNamespaceName: DEPLOYMENT_NAMESPACE,
      authorizationConfig: namespaceAuth,
    });
    const user = this.api.addChannelNamespace('UserNamespace', {
      channelNamespaceName: USER_NAMESPACE,
      authorizationConfig: namespaceAuth,
      code: appsync.Code.fromInline(OWN_CHANNEL_ONLY_HANDLER),
    });

    this.relay = this.relayFunction();
    deployment.grantPublish(this.relay);
    user.grantPublish(this.relay);
    this.routeEvents(this.relay);

    new ssm.StringParameter(this, 'HttpDomainParameter', {
      parameterName: LIVE_EVENTS_PARAMETERS.httpDomain,
      description: 'HTTP domain of the live events (AppSync Events) API, read into the dashboard config.json',
      stringValue: this.api.httpDns,
    });
    new ssm.StringParameter(this, 'RealtimeDomainParameter', {
      parameterName: LIVE_EVENTS_PARAMETERS.realtimeDomain,
      description: 'Real-time (WebSocket) domain of the live events (AppSync Events) API, read into config.json',
      stringValue: this.api.realtimeDns,
    });
    new cdk.CfnOutput(this, 'LiveEventsHttpDomain', { value: this.api.httpDns, description: 'AppSync Events HTTP domain' });
    new cdk.CfnOutput(this, 'LiveEventsRealtimeDomain', {
      value: this.api.realtimeDns, description: 'AppSync Events real-time (WebSocket) domain',
    });
  }

  /** The relay: one event in, one signed publish out; the publish grants are its only permissions besides its logs. */
  private relayFunction(): lambda.Function {
    const role = lambdaServiceRole(
      this, 'RelayRole', 'CitationAnalysis-LiveEventsRelayRole',
      'Publishes state-change events to the live events channels; nothing else'
    );
    return pythonFunction(this, 'LiveEventsRelay', {
      functionName: LIVE_EVENTS_RELAY_FUNCTION_NAME,
      description: 'Live events: forwards a state-change event from EventBridge to its AppSync Events channel',
      handler: 'handler.handler',
      code: lambdaSourceCode('live-events'),
      role,
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
      environment: {
        EVENTS_HTTP_DOMAIN: this.api.httpDns,
        STATE_MACHINE_TOPICS: JSON.stringify(STATE_MACHINE_TOPICS),
      },
    }, cdk.RemovalPolicy.DESTROY);
  }

  /**
   * Two rules on the default bus, both to the relay: the platform's own change events (`citation-analysis.*`), and
   * the Step Functions status changes of the state machines whose progress a dashboard watches. A failed delivery
   * is retried for up to an hour; an event older than that is stale for a screen anyway.
   */
  private routeEvents(relay: lambda.IFunction): void {
    const target = new targets.LambdaFunction(relay, { retryAttempts: 4, maxEventAge: cdk.Duration.hours(1) });
    new events.Rule(this, 'ChangeEventsRule', {
      description: 'State-change events the platform publishes, to the live events relay',
      eventPattern: { source: events.Match.prefix(CHANGE_EVENT_SOURCE_PREFIX) },
      targets: [target],
    });
    new events.Rule(this, 'StateMachineStatusRule', {
      description: 'Status changes of the workflow, research and snapshot build state machines, to the live events relay',
      eventPattern: {
        source: ['aws.states'],
        detailType: ['Step Functions Execution Status Change'],
        detail: {
          stateMachineArn: Object.keys(STATE_MACHINE_TOPICS).map((name) => this.formatArn({
            service: 'states', resource: 'stateMachine', resourceName: name, arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
          })),
        },
      },
      targets: [target],
    });
  }
}
