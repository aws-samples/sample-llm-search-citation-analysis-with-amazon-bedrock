import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { CitationAnalysisStack } from './citation-analysis-stack';
import { allowStatementsOfRole, findFunctionRoleLogicalId, resolvePath, statementActions } from './citation-analysis-stack-fixtures';
import { CitationAnalysisEventsStack } from './events-stack';

/** The events stack on its own, environment-agnostic like the other stack specs. */
export function synthesizeEventsTemplate(): Template {
  const app = new cdk.App();
  return Template.fromStack(new CitationAnalysisEventsStack(app, 'EventsStackTest'));
}

/** The main stack, environment-agnostic. */
export function synthesizeMainForEvents(): Template {
  const app = new cdk.App();
  return Template.fromStack(new CitationAnalysisStack(app, 'EventsMainTest'));
}

/** The `events:source` values each `events:PutEvents` statement on `functionName`'s role allows, one list per statement. */
export function putEventsSources(template: Template, functionName: string): unknown[] {
  return allowStatementsOfRole(template, findFunctionRoleLogicalId(template, functionName))
    .filter((statement) => statementActions(statement).includes('events:PutEvents'))
    .map((statement) => resolvePath(statement, ['Condition', 'StringEquals', 'events:source']));
}

/** Every resource type of `template` but CDK's own metadata, sorted and deduplicated. */
export function resourceTypes(template: Template): string[] {
  const resources = Object.values(template.toJSON().Resources ?? {}) as { Type: string }[];
  return [...new Set(resources.map((resource) => resource.Type))].filter((type) => type !== 'AWS::CDK::Metadata').sort((a, b) => a.localeCompare(b));
}
