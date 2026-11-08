import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { allow } from './permissions';

/**
 * Bedrock model tier defaults per task role.
 *
 * Tiers map to model families in lambda/shared/models.py:
 *   fast     -> Haiku
 *   balanced -> Sonnet
 *   deep     -> Opus
 *
 * Lambdas read BEDROCK_TIER_<ROLE> and resolve the model ID via
 * shared.models.get_model_id(). An administrator can replace a tier's model in
 * Settings › Bedrock models (ProviderConfig rows `bedrock-<tier>`, read through
 * DYNAMODB_TABLE_PROVIDER_CONFIG; see `allowSavedBedrockModels`). To pin a
 * specific model ID in an incident, set BEDROCK_MODEL_<ROLE> (takes precedence
 * over both).
 */
export const bedrockTierEnv = {
  BEDROCK_TIER_SUMMARIZATION: 'fast',
  BEDROCK_TIER_EXTRACTION:    'fast',
  BEDROCK_TIER_GENERATION:    'fast',
  BEDROCK_TIER_ANALYSIS:      'balanced',
  // Research agent (2.5.0): planning and the final selection reason over the
  // whole brief; judging a round is a cheaper, high-volume call.
  BEDROCK_TIER_RESEARCH_PLANNING:   'balanced',
  BEDROCK_TIER_RESEARCH_EVALUATION: 'fast',
} as const;

/**
 * `bedrock:InvokeModel` on the Claude models the stacks call through the
 * Converse API. The Converse API requires bedrock:InvokeModel permission (not
 * bedrock:Converse), and global cross-region inference requires all three ARN
 * patterns per AWS docs: the regional inference profile, the regional
 * foundation model and the global foundation model (no region/account).
 *
 * Anthropic models are AWS Marketplace products. This statement deliberately
 * does NOT grant `aws-marketplace:Subscribe`: the account-level subscription is
 * created once at deploy time by the BedrockModelAccess construct, so the
 * runtime roles never need Marketplace permissions of their own.
 */
export function claudeInvokeModelStatement(stack: cdk.Stack): iam.PolicyStatement {
  return new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ['bedrock:InvokeModel'],
    resources: [
      `arn:aws:bedrock:*:${stack.account}:inference-profile/global.anthropic.claude-*`,
      'arn:aws:bedrock:*::foundation-model/anthropic.claude-*',
      'arn:aws:bedrock:::foundation-model/anthropic.claude-*',
    ],
  });
}

/**
 * `dynamodb:GetItem` on the ProviderConfig table for a Lambda that calls
 * `shared.models`: it reads the model an administrator saved per tier in
 * Settings › Bedrock models (rows `bedrock-<tier>`). Pair it with the
 * `DYNAMODB_TABLE_PROVIDER_CONFIG` environment variable; without either the
 * Lambda falls back to the tier defaults.
 */
export function allowSavedBedrockModels(grantee: iam.IGrantable, providerConfigTable: dynamodb.ITable): void {
  allow(grantee, ['dynamodb:GetItem'], [providerConfigTable.tableArn]);
}
