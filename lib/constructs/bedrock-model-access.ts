import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

/**
 * Anthropic models on Bedrock sit behind three independent gates, and IAM is
 * only one of them:
 *
 *   1. `bedrock:InvokeModel` on the model — granted per Lambda role in the stack.
 *   2. The Anthropic first-time-use form — once per account, us-east-1 only.
 *   3. An AWS Marketplace subscription for the model — once per account.
 *
 * An account that has never used Anthropic fails its first Converse call with
 * "Model access is denied due to IAM user or service role is not authorized to
 * perform the required AWS Marketplace actions (aws-marketplace:ViewSubscriptions,
 * aws-marketplace:Subscribe)", because Bedrock tries to create the subscription
 * just-in-time using the *caller's* permissions.
 *
 * This construct closes gates 2 and 3 at deploy time, so the runtime roles need
 * no Marketplace permissions at all — only this construct's provisioning Lambda
 * does. Both operations are idempotent and survive stack deletion: they are
 * account state, not stack resources.
 */

/** Thrown at synth time when the Anthropic use-case form is not usable. */
export class AnthropicUseCaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnthropicUseCaseError';
  }
}

/**
 * `intendedUsers` is an index the form API expects as a string:
 * 0 = internal employees, 1 = external customers, 2 = both.
 */
export type IntendedUsers = '0' | '1' | '2';

export interface AnthropicUseCase {
  companyName: string;
  companyWebsite: string;
  intendedUsers: IntendedUsers;
  industryOption: string;
  useCases: string;
  otherIndustryOption?: string;
}

export interface BedrockModelAccessProps {
  /** Anthropic first-time-use form contents. Submitted once per account. */
  useCase: AnthropicUseCase;
  /**
   * Foundation model IDs to subscribe, e.g. `anthropic.claude-sonnet-4-6`.
   * These are the plain model IDs, not the `global.` inference profile IDs the
   * runtime calls: a subscription is per foundation model.
   */
  modelIds: string[];
  /** Region whose Bedrock endpoint creates the agreements. */
  modelRegion: string;
}

const MINIMUM_USE_CASE_LENGTH = 10;

/** us-east-1 is the only endpoint that serves PutUseCaseForModelAccess. */
const USE_CASE_FORM_REGION = 'us-east-1';

/**
 * Which error names to tolerate when submitting the use-case form: everything
 * except the two transient ones.
 *
 * `ignoreErrorCodesMatching` is a regex CDK tests against the SDK error's
 * `name`, so this is a negative lookahead rather than an allowlist. An
 * allowlist has to name every way an account can refuse the form — a previous
 * submission, an org-level grant, an AWS-internal account ("Internal Accounts
 * should not submit use case details"), an SCP denying
 * `bedrock:PutUseCaseForModelAccess` — and 2.15.0 proved that unwinnable: it
 * named `ValidationException|ConflictException` (the latter is not even
 * modelled for this operation) and an internal account's refusal, whose name we
 * still have no way to observe, rolled the whole stack back.
 *
 * Inverting it removes the guesswork. Any refusal, named or not, is tolerated:
 * none of them is a reason to fail a deployment, and the Marketplace agreements
 * created next report their own outcome per model. The two transient errors stay
 * fatal, because the submission runs `onCreate` only under a fixed physical ID,
 * so a tolerated error is never retried on a later deploy — swallowing one would
 * leave a genuinely fresh account permanently unprovisioned and silent, the
 * failure this construct exists to prevent. The AWS SDK already retries both
 * before surfacing them, so reaching here means they persisted, and a failed
 * deploy the operator can retry beats an account that quietly never works.
 */
const TOLERATE_EVERY_REFUSAL_BUT_TRANSIENT =
  '^(?!ThrottlingException$|InternalServerException$)';

function validate(useCase: AnthropicUseCase, modelIds: string[]): void {
  if (!useCase.companyName.trim()) {
    throw new AnthropicUseCaseError('companyName is required for the Anthropic use-case form');
  }
  if (!/^https?:\/\/\S+$/.test(useCase.companyWebsite)) {
    throw new AnthropicUseCaseError(
      `companyWebsite must be an http(s) URL, got ${JSON.stringify(useCase.companyWebsite)}`
    );
  }
  if (useCase.useCases.trim().length < MINIMUM_USE_CASE_LENGTH) {
    throw new AnthropicUseCaseError(
      `useCases must describe the workload in at least ${MINIMUM_USE_CASE_LENGTH} characters`
    );
  }
  if (modelIds.length === 0) {
    throw new AnthropicUseCaseError('modelIds must name at least one foundation model to subscribe');
  }
  const globalIds = modelIds.filter((modelId) => modelId.startsWith('global.'));
  if (globalIds.length > 0) {
    throw new AnthropicUseCaseError(
      `modelIds must be foundation model IDs, not inference profile IDs: ${globalIds.join(', ')}`
    );
  }
}

/**
 * Inline handler for the agreement custom resource. Kept inline (no asset) so
 * model enablement cannot itself fail on a missing bundle.
 */
function agreementHandlerCode(): string {
  return `
import boto3
import logging
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Failures that are a property of the ACCOUNT rather than a bug in this stack:
# a Private Marketplace, a missing payment method or an unsupported billing
# country all refuse the agreement. Failing the deployment would leave the
# customer with no stack at all instead of a stack whose Bedrock calls report a
# clear AccessDenied, so these are reported and tolerated.
NON_FATAL_ERROR_CODES = ('AccessDeniedException', 'ValidationException')


def _result(model_id, status, **extra):
    return {
        'PhysicalResourceId': f'model-agreement-{model_id}',
        'Data': {'status': status, 'modelId': model_id, **extra},
    }


def handler(event, context):
    """Create the Marketplace agreement for one foundation model."""
    request_type = event.get('RequestType', '')
    properties = event.get('ResourceProperties', {})
    model_id = properties.get('modelId', '')
    region = properties.get('region', '')

    logger.info('Request %s for model %s in %s', request_type, model_id, region)

    # Agreements are account state: they must outlive the stack, so Update and
    # Delete are no-ops. Deleting the subscription on stack delete would break
    # any other workload in the account that relies on the same model.
    if request_type != 'Create':
        return _result(model_id, 'SKIPPED')

    bedrock = boto3.client('bedrock', region_name=region)

    availability = bedrock.get_foundation_model_availability(modelId=model_id)
    agreement_status = availability.get('agreementAvailability', {}).get('status', 'UNKNOWN')
    logger.info('Agreement status for %s: %s', model_id, agreement_status)
    if agreement_status == 'AVAILABLE':
        return _result(model_id, 'ALREADY_AVAILABLE')

    offers = bedrock.list_foundation_model_agreement_offers(modelId=model_id).get('offers', [])
    if not offers:
        logger.warning('No agreement offers for %s', model_id)
        return _result(model_id, 'NO_OFFERS')

    offer_token = offers[0].get('offerToken')
    if not offer_token:
        raise RuntimeError(f'Agreement offer for {model_id} carried no offerToken')

    try:
        bedrock.create_foundation_model_agreement(modelId=model_id, offerToken=offer_token)
    except bedrock.exceptions.ConflictException:
        # Another deploy (or a human) created it between our check and now.
        return _result(model_id, 'ALREADY_EXISTS')
    except ClientError as error:
        code = error.response.get('Error', {}).get('Code', '')
        if code not in NON_FATAL_ERROR_CODES:
            raise
        logger.warning(
            'Agreement unavailable for %s (%s): %s. Continuing; Bedrock calls for '
            'this model will fail with AccessDenied until it is enabled by hand.',
            model_id, code, error,
        )
        return _result(model_id, 'UNAVAILABLE', errorCode=code)

    # The agreement goes PENDING then AVAILABLE within roughly a minute. The
    # rest of the stack takes longer than that to deploy, so no waiter here.
    logger.info('Created agreement for %s', model_id)
    return _result(model_id, 'CREATED')
`;
}

/** Submits the Anthropic use-case form and subscribes the Claude models. */
export class BedrockModelAccess extends Construct {
  /** Foundation models this construct created Marketplace agreements for. */
  public readonly subscribedModelIds: string[];

  constructor(scope: Construct, id: string, props: BedrockModelAccessProps) {
    super(scope, id);

    validate(props.useCase, props.modelIds);
    this.subscribedModelIds = [...props.modelIds];

    // The SDK's formData is a blob. CDK's custom-resource runtime turns a string
    // parameter into bytes with TextEncoder().encode(), so this must be the plain
    // JSON text: wrapping it in Fn.base64 would submit base64 *text* as the blob
    // body and store a doubly-encoded form.
    const formData = JSON.stringify({
      companyName: props.useCase.companyName,
      companyWebsite: props.useCase.companyWebsite,
      intendedUsers: props.useCase.intendedUsers,
      industryOption: props.useCase.industryOption,
      otherIndustryOption: props.useCase.otherIndustryOption ?? '',
      useCases: props.useCase.useCases,
    });

    const submitUseCase = new cr.AwsCustomResource(this, 'SubmitAnthropicUseCase', {
      onCreate: {
        service: 'Bedrock',
        action: 'putUseCaseForModelAccess',
        parameters: { formData },
        physicalResourceId: cr.PhysicalResourceId.of('anthropic-use-case-submission'),
        region: USE_CASE_FORM_REGION,
        ignoreErrorCodesMatching: TOLERATE_EVERY_REFUSAL_BUT_TRANSIENT,
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['bedrock:PutUseCaseForModelAccess'],
          resources: ['*'],
        }),
      ]),
      logGroup: new logs.LogGroup(this, 'SubmitAnthropicUseCaseLogs', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    const agreementHandler = new lambda.Function(this, 'ModelAgreementHandler', {
      functionName: 'CitationAnalysis-BedrockModelAgreement',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromInline(agreementHandlerCode()),
      timeout: cdk.Duration.minutes(2),
      memorySize: 256,
      description: 'Subscribes the Claude models this stack invokes (AWS Marketplace agreement)',
      logGroup: new logs.LogGroup(this, 'ModelAgreementHandlerLogs', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    agreementHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'bedrock:GetFoundationModelAvailability',
        'bedrock:ListFoundationModelAgreementOffers',
        'bedrock:CreateFoundationModelAgreement',
      ],
      // None of these three accept a resource ARN.
      resources: ['*'],
    }));

    // The Marketplace subscription Bedrock creates on our behalf. Scoped to
    // calls Bedrock makes for this role, and held only by this deploy-time
    // function — never by the Lambdas that serve traffic.
    agreementHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['aws-marketplace:ViewSubscriptions', 'aws-marketplace:Subscribe'],
      resources: ['*'],
      conditions: { StringEquals: { 'aws:CalledViaLast': 'bedrock.amazonaws.com' } },
    }));

    const agreementProvider = new cr.Provider(this, 'ModelAgreementProvider', {
      onEventHandler: agreementHandler,
      logGroup: new logs.LogGroup(this, 'ModelAgreementProviderLogs', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    for (const modelId of props.modelIds) {
      const agreement = new cdk.CustomResource(this, `ModelAgreement-${modelId}`, {
        serviceToken: agreementProvider.serviceToken,
        properties: { modelId, region: props.modelRegion },
      });
      // The form gates the subscription: submitting it after the agreement
      // attempt would make the first deploy in a fresh account fail.
      agreement.node.addDependency(submitUseCase);
    }
  }
}
