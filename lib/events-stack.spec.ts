import { describe, expect, it } from 'vitest';
import { Match } from 'aws-cdk-lib/assertions';
import { binAppSource } from './api-stack-fixtures';
import {
  allowStatementsOfRole, extractLambdaEnvVars, extractStateMachineStates, findFunctionRoleLogicalId, resolvePath, statementActions,
} from './citation-analysis-stack-fixtures';
import {
  DEPLOYMENT_NAMESPACE, LIVE_EVENTS_RELAY_FUNCTION_NAME, USER_NAMESPACE
} from './events-stack';
import {
  importOwnChannelHandler, putEventsSources, resourceTypes, subscribeContext, synthesizeEventsTemplate
} from './events-stack-fixtures';
import { synthesizeMainTemplate } from './web-search-stack-fixtures';
import { LIVE_EVENTS_PARAMETERS, STATE_MACHINE_TOPICS, WORKFLOW_STATE_MACHINE_NAME } from './constructs/live-events';

/**
 * CitationAnalysisEventsStack (2.51.0, TENETS.md tenet 8): the AppSync Events API the dashboard subscribes to,
 * the relay from EventBridge, and the grants that let each producer announce only its own changes.
 */
const template = synthesizeEventsTemplate();
const COGNITO = { AuthType: 'AMAZON_COGNITO_USER_POOLS' };
const IAM = { AuthType: 'AWS_IAM' };

describe('the Event API', () => {
  it('lets signed-in Cognito users connect and subscribe, and only IAM publish', () => {
    expect(() => template.hasResourceProperties('AWS::AppSync::Api', {
      Name: 'CitationAnalysis-LiveEvents',
      EventConfig: {
        AuthProviders: [Match.objectLike({ ...COGNITO, CognitoConfig: Match.objectLike({ UserPoolId: Match.anyValue() }) }), IAM],
        ConnectionAuthModes: [COGNITO],
        DefaultPublishAuthModes: [IAM],
        DefaultSubscribeAuthModes: [COGNITO],
      },
    })).not.toThrow();
  });

  it('reads the user pool from the parameter the main stack writes, with no cross-stack reference', () => {
    const parameters = Object.values(template.toJSON().Parameters ?? {}) as { Default?: string }[];
    expect(parameters.map((parameter) => parameter.Default)).toContain('/citation-analysis/user-pool-id');
    expect(JSON.stringify(template.toJSON())).not.toContain('Fn::ImportValue');
  });

  it.each([DEPLOYMENT_NAMESPACE, USER_NAMESPACE])('has the %s namespace, subscribed with Cognito and published with IAM only', (name) => {
    expect(() => template.hasResourceProperties('AWS::AppSync::ChannelNamespace', {
      Name: name,
      PublishAuthModes: [IAM],
      SubscribeAuthModes: [COGNITO],
    })).not.toThrow();
  });

  it('runs a subscribe handler on the user namespace only', () => {
    const namespaces = Object.values(template.findResources('AWS::AppSync::ChannelNamespace'))
      .map((resource) => [resolvePath(resource, ['Properties', 'Name']), resolvePath(resource, ['Properties', 'CodeHandlers']) !== undefined]);
    expect(Object.fromEntries(namespaces)).toStrictEqual({ [DEPLOYMENT_NAMESPACE]: false, [USER_NAMESPACE]: true });
  });
});

describe('the user namespace subscribe handler', () => {
  // The handler runs as written, imported from a temporary module; AppSync's `util` is a stub that throws.
  const SUB = '3f1c2a4e-9b7d-4e21-8a55-0c6d2f1e9a10';

  it('lets a caller subscribe to their own exports channel', async () => {
    const { onSubscribe } = await importOwnChannelHandler();
    expect(() => onSubscribe(subscribeContext(`/user/${SUB}/exports`, SUB))).not.toThrow();
  });

  it.each([
    ['another user’s channel', `/user/0d6f2a4e-1111-4e21-8a55-0c6d2f1e9a10/exports`, SUB],
    ['every user’s channel by wildcard', '/user/*', SUB],
    ['a channel without an owner segment', '/user', SUB],
    ['a caller without an identity', `/user/${SUB}/exports`, null],
  ])('refuses %s', async (_case, channel, sub) => {
    const { onSubscribe } = await importOwnChannelHandler();
    expect(() => onSubscribe(subscribeContext(channel, sub))).toThrow('Unauthorized');
  });
});

describe('the relay', () => {
  it('is run again twice within the hour when a publish fails, then the event is dropped', () => {
    const configs = Object.values(template.findResources('AWS::Lambda::EventInvokeConfig'))
      .map((resource) => [resolvePath(resource, ['Properties', 'MaximumRetryAttempts']), resolvePath(resource, ['Properties', 'MaximumEventAgeInSeconds'])]);
    expect(configs).toStrictEqual([[2, 3600]]);
  });

  it('may only publish to the two namespaces', () => {
    const statements = allowStatementsOfRole(template, findFunctionRoleLogicalId(template, LIVE_EVENTS_RELAY_FUNCTION_NAME));
    expect([...new Set(statements.flatMap(statementActions))]).toStrictEqual(['appsync:EventPublish']);
    expect(JSON.stringify(statements)).toMatch(/channelNamespace\/deployment.*channelNamespace\/user/u);
  });

  it('knows the API domain and which state machine goes to which topic', () => {
    const env = extractLambdaEnvVars(template, LIVE_EVENTS_RELAY_FUNCTION_NAME);
    expect(JSON.parse(String(env.STATE_MACHINE_TOPICS))).toStrictEqual(STATE_MACHINE_TOPICS);
    expect(env.EVENTS_HTTP_DOMAIN).toStrictEqual({ 'Fn::GetAtt': [expect.stringMatching(/^LiveEventsApi/u), 'Dns.Http'] });
  });

  it('hears the platform’s change events and the watched state machines’ status changes, retrying for an hour', () => {
    const rules = Object.values(template.findResources('AWS::Events::Rule')).map((rule) => resolvePath(rule, ['Properties']));
    expect(rules.map((rule) => resolvePath(rule, ['EventPattern']))).toStrictEqual([
      { source: [{ prefix: 'citation-analysis.' }] },
      {
        source: ['aws.states'],
        'detail-type': ['Step Functions Execution Status Change'],
        detail: {
          stateMachineArn: Object.keys(STATE_MACHINE_TOPICS).map((name) => ({
            'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':states:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, `:stateMachine:${name}`]],
          })),
        },
      },
    ]);
    expect(rules.map((rule) => resolvePath(rule, ['Targets', '0', 'RetryPolicy']))).toStrictEqual([
      { MaximumEventAgeInSeconds: 3600, MaximumRetryAttempts: 4 }, { MaximumEventAgeInSeconds: 3600, MaximumRetryAttempts: 4 },
    ]);
  });
});

describe('the stack', () => {
  it('writes the API domains where the API stack reads them for config.json', () => {
    const names = Object.values(template.findResources('AWS::SSM::Parameter')).map((parameter) => resolvePath(parameter, ['Properties', 'Name']));
    expect(names).toStrictEqual([LIVE_EVENTS_PARAMETERS.httpDomain, LIVE_EVENTS_PARAMETERS.realtimeDomain]);
  });

  it('holds only resources paid per use, so an idle deployment pays nothing for it (tenet 7)', () => {
    expect(resourceTypes(template)).toStrictEqual([
      'AWS::AppSync::Api', 'AWS::AppSync::ChannelNamespace', 'AWS::Events::Rule', 'AWS::IAM::Policy', 'AWS::IAM::Role',
      'AWS::Lambda::EventInvokeConfig', 'AWS::Lambda::Function', 'AWS::Lambda::Permission', 'AWS::Logs::LogGroup', 'AWS::SSM::Parameter',
    ]);
  });

  it('deploys after the main stack and before the API stack (bin/)', () => {
    const source = binAppSource();
    expect(source).toContain('eventsStack.node.addDependency(stack);');
    expect(source).toContain('apiStack.node.addDependency(eventsStack);');
  });
});

describe('the producers in the main stack', () => {
  const main = synthesizeMainTemplate();

  it.each([
    ['CitationAnalysis-GenerateSummary', ['citation-analysis.runs', 'citation-analysis.views', 'citation-analysis.snapshots']],
    ['CitationAnalysis-KpiAlerts', ['citation-analysis.runs', 'citation-analysis.alerts']],
    ['CitationAnalysis-ReportInsights', ['citation-analysis.insights']],
    ['CitationAnalysis-API-SelfReflection', ['citation-analysis.insights']],
    ['CitationAnalysis-ResearchWorker', ['citation-analysis.research']],
    ['CitationAnalysis-API-ContentStudio', ['citation-analysis.content-studio']],
    ['CitationAnalysis-ContentStudioWorker', ['citation-analysis.content-studio']],
    ['CitationAnalysis-ExportWorker', ['citation-analysis.exports']],
    ['CitationAnalysis-API-Exports', ['citation-analysis.exports']],
  ])('lets %s put events under its own sources only', (functionName, sources) => {
    expect(putEventsSources(main, functionName)).toStrictEqual([sources]);
  });

  it('ends every keyword of a run with a progress event that cannot fail the keyword', () => {
    const states = extractStateMachineStates(main, WORKFLOW_STATE_MACHINE_NAME);
    const keyword = JSON.stringify(states);
    expect(keyword).toContain('"PublishKeywordProgress"');
    expect(keyword).toContain('"DetailType":"run.keyword.finished"');
    expect(keyword).toMatch(/"Catch":\[\{"ErrorEquals":\["States\.ALL"\],"ResultPath":null,"Next":"KeywordProgressNotPublished"\}\]/u);
  });
});
