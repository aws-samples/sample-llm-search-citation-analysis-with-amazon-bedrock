import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

/** A role the Lambda service assumes, with only the basic CloudWatch Logs execution policy attached. */
export function lambdaServiceRole(scope: Construct, id: string, roleName: string, description: string): iam.Role {
  return new iam.Role(scope, id, {
    roleName,
    assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    description,
    managedPolicies: [
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
    ],
  });
}

/** Allow `actions` on `resources` in the grantee's identity policy. */
export function allow(grantee: iam.IGrantable, actions: string[], resources: string[]): void {
  grantee.grantPrincipal.addToPrincipalPolicy(new iam.PolicyStatement({ actions, resources }));
}

/** {@link allow}, only when `conditions` hold (for example `dynamodb:LeadingKeys`, to reach some items only). */
export function allowWhere(
  grantee: iam.IGrantable, actions: string[], resources: string[], conditions: Record<string, unknown>
): void {
  grantee.grantPrincipal.addToPrincipalPolicy(new iam.PolicyStatement({ actions, resources, conditions }));
}

/** An imported provider API key secret `citation-analysis/<keyName>-key`; an admin creates it from the dashboard. */
export function apiKeySecret(scope: Construct, id: string, keyName: string): secretsmanager.ISecret {
  return secretsmanager.Secret.fromSecretNameV2(scope, id, `citation-analysis/${keyName}-key`);
}

/**
 * Removes CDK's auto-generated per-method `Lambda::Permission` resources of
 * the given functions; their `ApiGatewayWildcard` permission covers every
 * method. An Aspect, because the permissions are created on the API Gateway
 * method constructs, not on the Lambda.
 */
class RemoveDuplicatePermissions implements cdk.IAspect {
  private readonly fnArnStrings: string[];
  constructor(fns: lambda.Function[]) {
    this.fnArnStrings = fns.map(fn => JSON.stringify(fn.functionArn));
  }
  public visit(node: Construct): void {
    if (node instanceof lambda.CfnPermission) {
      if (node.node.id === 'ApiGatewayWildcard') return;
      const fnNameStr = JSON.stringify(node.functionName);
      if (this.fnArnStrings.includes(fnNameStr)) {
        const parent = node.node.scope;
        if (parent) {
          parent.node.tryRemoveChild(node.node.id);
        }
      }
    }
  }
}

/**
 * One wildcard `ApiGatewayWildcard` invoke permission per consolidated
 * function instead of CDK's two per API method (prod + test-invoke).
 *
 * Safe because all routes share the same Cognito authorizer and the Lambda
 * handles its own routing; AWS docs support wildcard source ARNs for
 * execute-api.
 */
export function shareOneApiPermission(scope: Construct, api: apigateway.RestApi, fns: lambda.Function[]): void {
  for (const fn of fns) {
    fn.addPermission('ApiGatewayWildcard', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: api.arnForExecuteApi('*'),
    });
  }
  cdk.Aspects.of(scope).add(new RemoveDuplicatePermissions(fns));
}
