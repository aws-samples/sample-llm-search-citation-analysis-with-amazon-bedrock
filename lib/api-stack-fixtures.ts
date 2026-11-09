import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { CitationAnalysisApiStack } from './api-stack';
import { CitationAnalysisStack } from './citation-analysis-stack';
import {
  collectGetAttTargets,
  extractApiAuthSnapshots,
  importedExportNames,
  namedFunctions,
  resolvePath,
  resolveString,
  sortedUnique,
  type ApiMethodAuthSnapshot,
} from './citation-analysis-stack-fixtures';

/** The main stack and the dashboard API stack of one app, as `bin/` wires them. */
export interface DashboardStacks {
  readonly main: CitationAnalysisStack;
  readonly api: CitationAnalysisApiStack;
  readonly mainTemplate: Template;
  readonly apiTemplate: Template;
}

/**
 * Synthesize the main stack and the API stack, with `context` as CDK
 * context. Both are environment-agnostic, like the main stack's other specs,
 * so ARNs keep their `AWS::Region` / `AWS::AccountId` refs. The API stack
 * depends on the main stack explicitly, as in `bin/`: it holds no reference
 * to it that CDK could infer an order from.
 */
export function synthesizeDashboardStacks(id: string, context: Record<string, string> = {}): DashboardStacks {
  const app = new cdk.App({ context });
  const main = new CitationAnalysisStack(app, `${id}Main`);
  const api = new CitationAnalysisApiStack(app, `${id}Api`);
  api.node.addDependency(main);
  return {
    main,
    api,
    mainTemplate: Template.fromStack(main),
    apiTemplate: Template.fromStack(api),
  };
}

/** One `AWS::Lambda::Permission` of a template: the function name(s) its ARN spells out and its source ARN. */
export interface InvokePermissionSnapshot {
  functionNames: string[];
  /** Logical ids of the functions the permission names by `Fn::GetAtt` (a function of the same template). */
  functionLogicalIds: string[];
  principal: string;
  /** The source ARN as JSON, so its literal parts (`/*\/*\/*`, `/test-invoke-stage/`) can be matched as text. */
  sourceArn: string;
}

/** One export of the main stack: its name without the `<stack name>:` prefix, and its value. */
export interface StackExportSnapshot {
  localName: string;
  prefix: string;
  value: unknown;
}

/** Everything the API-stack spec asserts on, read once from the synthesized templates. */
export interface ApiStackSnapshot {
  routes: ApiMethodAuthSnapshot[];
  resourceCount: number;
  preflightCount: number;
  authorizers: unknown[];
  stageMethodSettings: unknown;
  usagePlans: unknown[];
  gatewayResponseOrigins: unknown[];
  permissions: InvokePermissionSnapshot[];
  /** Every `Fn::ImportValue` export name in the API template. */
  apiImports: string[];
  /** The API template's SSM-backed parameters (but CDK's `BootstrapVersion`), by the SSM parameter name each reads. */
  apiSsmParameters: Record<string, { type: unknown; logicalId: string }>;
  /** Every Lambda function name the API template's ARNs spell out, sorted, once each. */
  referencedFunctionNames: string[];
  runtimeConfigDeployments: unknown[];
  outputs: Record<string, unknown>;
  apiGatewayAccounts: number;
  mainTemplateImports: string[];
  mainApiGatewayResourceTypes: string[];
  mainApiGatewayPermissions: number;
  mainWebDeployment: unknown;
  mainOutputKeys: string[];
  mainFunctionNames: string[];
  mainWebBucketName: unknown;
  /** The main stack's SSM parameters, name to value. */
  mainSsmParameters: Record<string, unknown>;
  /** The main stack's `ExportsOutput...` exports (CDK's naming for cross-stack references). */
  mainReferenceExports: StackExportSnapshot[];
  /** Logical ids, in the main template, of the user pool and the dashboard distribution. */
  mainUserPoolLogicalId: string;
  mainDistributionLogicalId: string;
}

/** Every `AWS::Lambda::Permission` of `template`: whom it lets invoke which function, from which source. */
export function permissionsOf(template: Template): InvokePermissionSnapshot[] {
  return Object.values(template.findResources('AWS::Lambda::Permission')).map((permission) => ({
    functionNames: namedFunctions(resolvePath(permission, ['Properties', 'FunctionName'])),
    functionLogicalIds: collectGetAttTargets(resolvePath(permission, ['Properties', 'FunctionName'])),
    principal: resolveString(permission, ['Properties', 'Principal']),
    sourceArn: JSON.stringify(resolvePath(permission, ['Properties', 'SourceArn'])) ?? '',
  }));
}

function propertiesOfType(template: Template, type: string): unknown[] {
  return Object.values(template.findResources(type)).map((resource) => resolvePath(resource, ['Properties']));
}

function referenceExports(mainTemplate: Template): StackExportSnapshot[] {
  return Object.values(mainTemplate.findOutputs('*'))
    .map((output) => ({ name: resolveString(output, ['Export', 'Name']), value: resolvePath(output, ['Value']) }))
    .filter(({ name }) => name.includes(':ExportsOutput'))
    .map(({ name, value }) => {
      const separator = name.indexOf(':');
      return { localName: name.slice(separator + 1), prefix: name.slice(0, separator), value };
    })
    .sort((left, right) => left.localName.localeCompare(right.localName));
}

function firstLogicalId(template: Template, type: string, logicalIdPrefix: string): string {
  return Object.keys(template.findResources(type)).find((logicalId) => logicalId.startsWith(logicalIdPrefix)) ?? '';
}

/** The invoke permissions in `snapshot` that reach the main-stack function named `functionName`. */
export function permissionsOfFunction(snapshot: ApiStackSnapshot, functionName: string): InvokePermissionSnapshot[] {
  return snapshot.permissions.filter((permission) => permission.functionNames.includes(functionName));
}

/** `bin/citation-analysis-system.ts` as text: the app wiring the specs cannot synthesize cheaply (it builds every stack). */
export function binAppSource(): string {
  return fs.readFileSync(path.join(__dirname, '../bin/citation-analysis-system.ts'), 'utf8');
}

/** Read the API-stack spec's facts out of both templates. */
export function extractApiStackSnapshot({ mainTemplate, apiTemplate }: DashboardStacks): ApiStackSnapshot {
  const mainResources: [string, unknown][] = Object.entries(resolvePath(mainTemplate.toJSON(), ['Resources']) ?? {});
  const methods = propertiesOfType(apiTemplate, 'AWS::ApiGateway::Method');
  const [stage] = propertiesOfType(apiTemplate, 'AWS::ApiGateway::Stage');
  const [mainWebDeployment] = Object.entries(mainTemplate.findResources('Custom::CDKBucketDeployment'))
    .filter(([logicalId]) => logicalId.startsWith('DeployWebsite'))
    .map(([, resource]) => resolvePath(resource, ['Properties']));
  const parameters = resolvePath(apiTemplate.toJSON(), ['Parameters']);
  const mainFunctions = propertiesOfType(mainTemplate, 'AWS::Lambda::Function');
  const [webBucket] = propertiesOfType(mainTemplate, 'AWS::S3::Bucket')
    .filter((bucket) => JSON.stringify(resolvePath(bucket, ['BucketName'])).includes('citation-analysis-web-'));
  return {
    routes: extractApiAuthSnapshots(apiTemplate),
    resourceCount: Object.keys(apiTemplate.findResources('AWS::ApiGateway::Resource')).length,
    preflightCount: methods.filter((method) => resolveString(method, ['HttpMethod']) === 'OPTIONS').length,
    authorizers: propertiesOfType(apiTemplate, 'AWS::ApiGateway::Authorizer'),
    stageMethodSettings: resolvePath(stage, ['MethodSettings']),
    usagePlans: propertiesOfType(apiTemplate, 'AWS::ApiGateway::UsagePlan'),
    gatewayResponseOrigins: propertiesOfType(apiTemplate, 'AWS::ApiGateway::GatewayResponse')
      .map((response) => resolvePath(response, ['ResponseParameters', 'gatewayresponse.header.Access-Control-Allow-Origin'])),
    permissions: permissionsOf(apiTemplate),
    apiImports: importedExportNames(apiTemplate.toJSON()),
    apiSsmParameters: Object.fromEntries(Object.entries(typeof parameters === 'object' && parameters !== null ? parameters : {})
      .filter(([logicalId]) => logicalId !== 'BootstrapVersion')
      .map(([logicalId, parameter]) => [resolveString(parameter, ['Default']), { type: resolvePath(parameter, ['Type']), logicalId }])),
    referencedFunctionNames: sortedUnique(namedFunctions(apiTemplate.toJSON())),
    runtimeConfigDeployments: propertiesOfType(apiTemplate, 'Custom::CDKBucketDeployment'),
    outputs: apiTemplate.findOutputs('*'),
    apiGatewayAccounts: Object.keys(apiTemplate.findResources('AWS::ApiGateway::Account')).length,
    mainTemplateImports: importedExportNames(mainTemplate.toJSON()),
    mainApiGatewayResourceTypes: mainResources
      .map(([, resource]) => resolveString(resource, ['Type']))
      .filter((type) => type.startsWith('AWS::ApiGateway::')),
    mainApiGatewayPermissions: permissionsOf(mainTemplate)
      .filter((permission) => permission.principal === 'apigateway.amazonaws.com').length,
    mainWebDeployment,
    mainOutputKeys: Object.keys(mainTemplate.findOutputs('*')),
    mainFunctionNames: sortedUnique(mainFunctions.map((fn) => resolveString(fn, ['FunctionName']))),
    mainWebBucketName: resolvePath(webBucket, ['BucketName']),
    mainSsmParameters: Object.fromEntries(propertiesOfType(mainTemplate, 'AWS::SSM::Parameter')
      .map((parameter) => [resolveString(parameter, ['Name']), resolvePath(parameter, ['Value'])])),
    mainReferenceExports: referenceExports(mainTemplate),
    mainUserPoolLogicalId: firstLogicalId(mainTemplate, 'AWS::Cognito::UserPool', 'Auth'),
    mainDistributionLogicalId: firstLogicalId(mainTemplate, 'AWS::CloudFront::Distribution', 'WebDistribution'),
  };
}
