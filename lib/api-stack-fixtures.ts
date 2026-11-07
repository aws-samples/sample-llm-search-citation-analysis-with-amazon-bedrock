import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { CitationAnalysisApiStack } from './api-stack';
import { CitationAnalysisStack } from './citation-analysis-stack';
import {
  extractApiAuthSnapshots,
  importedExportNames,
  importedLogicalIds,
  resolvePath,
  resolveString,
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
 * Synthesize the main stack and the API stack fed by its `apiInputs`, with
 * `context` as CDK context. Both are environment-agnostic, like the main
 * stack's other specs, so ARNs keep their `AWS::Region` / `AWS::AccountId`
 * refs. No explicit dependency is added: the one CDK infers from the
 * cross-stack references is what orders the deploy.
 */
export function synthesizeDashboardStacks(id: string, context: Record<string, string> = {}): DashboardStacks {
  const app = new cdk.App({ context });
  const main = new CitationAnalysisStack(app, `${id}Main`);
  const api = new CitationAnalysisApiStack(app, `${id}Api`, { inputs: main.apiInputs });
  return {
    main,
    api,
    mainTemplate: Template.fromStack(main),
    apiTemplate: Template.fromStack(api),
  };
}

/** One main-stack value the API stack imports, and the resource behind it. */
export interface ApiStackImport {
  exportName: string;
  /** CloudFormation type of the main-stack resource the export reads. */
  targetType: string;
  /** `FunctionName` / `BucketName` of that resource as the main template sets it, `undefined` when unset. */
  fixedName: unknown;
}

/** One `AWS::Lambda::Permission` of a template: the main-stack function(s) it reaches and its source ARN. */
export interface InvokePermissionSnapshot {
  functionLogicalIds: string[];
  principal: string;
  /** The source ARN as JSON, so its literal parts (`/*\/*\/*`, `/test-invoke-stage/`) can be matched as text. */
  sourceArn: string;
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
  imports: ApiStackImport[];
  runtimeConfigDeployments: unknown[];
  outputs: Record<string, unknown>;
  apiGatewayAccounts: number;
  mainTemplateImports: string[];
  mainApiGatewayResourceTypes: string[];
  mainApiGatewayPermissions: number;
  mainWebDeployment: unknown;
  mainOutputKeys: string[];
  /** Logical ids, in the main template, of the function each API key names. */
  functionLogicalIds: Record<string, string>;
}

const PERSISTENT_NAME_PROPERTY = new Map([
  ['AWS::Lambda::Function', 'FunctionName'],
  ['AWS::S3::Bucket', 'BucketName'],
]);

function importsOf(mainTemplate: Template, apiTemplate: Template): ApiStackImport[] {
  const resources = resolvePath(mainTemplate.toJSON(), ['Resources']);
  const names = [...new Set(importedExportNames(apiTemplate.toJSON()))].sort((left, right) => left.localeCompare(right));
  return names.map((exportName) => {
    const [logicalId] = importedLogicalIds(mainTemplate, { 'Fn::ImportValue': exportName });
    const resource = resolvePath(resources, [logicalId ?? '']);
    const targetType = resolveString(resource, ['Type']);
    const nameProperty = PERSISTENT_NAME_PROPERTY.get(targetType);
    return {
      exportName,
      targetType,
      fixedName: nameProperty === undefined ? undefined : resolvePath(resource, ['Properties', nameProperty]),
    };
  });
}

function permissionsOf(mainTemplate: Template, template: Template): InvokePermissionSnapshot[] {
  return Object.values(template.findResources('AWS::Lambda::Permission')).map((permission) => ({
    functionLogicalIds: importedLogicalIds(mainTemplate, resolvePath(permission, ['Properties', 'FunctionName'])),
    principal: resolveString(permission, ['Properties', 'Principal']),
    sourceArn: JSON.stringify(resolvePath(permission, ['Properties', 'SourceArn'])) ?? '',
  }));
}

function propertiesOfType(template: Template, type: string): unknown[] {
  return Object.values(template.findResources(type)).map((resource) => resolvePath(resource, ['Properties']));
}

function functionLogicalIdsByName(mainTemplate: Template): Record<string, string> {
  return Object.fromEntries(
    Object.entries(mainTemplate.findResources('AWS::Lambda::Function'))
      .map(([logicalId, resource]) => [resolveString(resource, ['Properties', 'FunctionName']), logicalId])
  );
}

/** The invoke permissions in `snapshot` that reach the main-stack function named `functionName`. */
export function permissionsOfFunction(snapshot: ApiStackSnapshot, functionName: string): InvokePermissionSnapshot[] {
  const logicalId = snapshot.functionLogicalIds[functionName];
  return snapshot.permissions.filter((permission) => permission.functionLogicalIds.includes(logicalId));
}

/** Read the API-stack spec's facts out of both templates. */
export function extractApiStackSnapshot({ mainTemplate, apiTemplate }: DashboardStacks): ApiStackSnapshot {
  const mainResources: [string, unknown][] = Object.entries(resolvePath(mainTemplate.toJSON(), ['Resources']) ?? {});
  const methods = propertiesOfType(apiTemplate, 'AWS::ApiGateway::Method');
  const [stage] = propertiesOfType(apiTemplate, 'AWS::ApiGateway::Stage');
  const [mainWebDeployment] = Object.entries(mainTemplate.findResources('Custom::CDKBucketDeployment'))
    .filter(([logicalId]) => logicalId.startsWith('DeployWebsite'))
    .map(([, resource]) => resolvePath(resource, ['Properties']));
  return {
    routes: extractApiAuthSnapshots(apiTemplate),
    resourceCount: Object.keys(apiTemplate.findResources('AWS::ApiGateway::Resource')).length,
    preflightCount: methods.filter((method) => resolveString(method, ['HttpMethod']) === 'OPTIONS').length,
    authorizers: propertiesOfType(apiTemplate, 'AWS::ApiGateway::Authorizer'),
    stageMethodSettings: resolvePath(stage, ['MethodSettings']),
    usagePlans: propertiesOfType(apiTemplate, 'AWS::ApiGateway::UsagePlan'),
    gatewayResponseOrigins: propertiesOfType(apiTemplate, 'AWS::ApiGateway::GatewayResponse')
      .map((response) => resolvePath(response, ['ResponseParameters', 'gatewayresponse.header.Access-Control-Allow-Origin'])),
    permissions: permissionsOf(mainTemplate, apiTemplate),
    imports: importsOf(mainTemplate, apiTemplate),
    runtimeConfigDeployments: propertiesOfType(apiTemplate, 'Custom::CDKBucketDeployment'),
    outputs: apiTemplate.findOutputs('*'),
    apiGatewayAccounts: Object.keys(apiTemplate.findResources('AWS::ApiGateway::Account')).length,
    mainTemplateImports: importedExportNames(mainTemplate.toJSON()),
    mainApiGatewayResourceTypes: mainResources
      .map(([, resource]) => resolveString(resource, ['Type']))
      .filter((type) => type.startsWith('AWS::ApiGateway::')),
    mainApiGatewayPermissions: permissionsOf(mainTemplate, mainTemplate)
      .filter((permission) => permission.principal === 'apigateway.amazonaws.com').length,
    mainWebDeployment,
    mainOutputKeys: Object.keys(mainTemplate.findOutputs('*')),
    functionLogicalIds: functionLogicalIdsByName(mainTemplate),
  };
}
