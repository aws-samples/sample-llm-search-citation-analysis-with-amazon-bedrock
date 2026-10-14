import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { CitationAnalysisStack } from './citation-analysis-stack';
import { allowStatementsOfRole, findFunctionRoleLogicalId, resolvePath } from './citation-analysis-stack-fixtures';
import { CitationAnalysisWebSearchStack } from './web-search-stack';

export const ACCOUNT = '123456789012';

export function synthesizeWebSearchTemplate(region: string): Template {
  const app = new cdk.App();
  const stack = new CitationAnalysisWebSearchStack(app, 'WebSearch', { env: { account: ACCOUNT, region } });
  return Template.fromStack(stack);
}

export function synthesizeMainTemplate(context: Record<string, string> = {}): Template {
  const app = new cdk.App({ context });
  const stack = new CitationAnalysisStack(app, 'Main', { env: { account: ACCOUNT, region: 'us-west-2' } });
  return Template.fromStack(stack);
}

/** Resources of the Allow statements, on the role the function runs as, that grant the action. */
export function functionRoleResourcesAllowing(template: Template, functionName: string, action: string): unknown[] {
  return allowStatementsOfRole(template, findFunctionRoleLogicalId(template, functionName))
    .filter((statement) => [resolvePath(statement, ['Action'])].flat().includes(action))
    .map((statement) => resolvePath(statement, ['Resource']));
}
