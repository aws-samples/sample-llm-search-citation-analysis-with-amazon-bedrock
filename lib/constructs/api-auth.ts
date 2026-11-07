import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

/**
 * Method options putting a route behind a Cognito user pool authorizer
 * (`<scope>/Authorizer`, reading the `Authorization` header). Without
 * `authorizationScopes` the authorizer accepts an ID token; with them it
 * requires an access token carrying one of the scopes.
 */
export function cognitoMethodOptions(
  scope: Construct,
  userPool: cognito.IUserPool,
  authorizerName: string,
  authorizationScopes?: string[],
): apigateway.MethodOptions {
  const authorizer = new apigateway.CognitoUserPoolsAuthorizer(scope, 'Authorizer', {
    cognitoUserPools: [userPool],
    authorizerName,
    identitySource: 'method.request.header.Authorization',
  });
  return { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO, authorizationScopes };
}
