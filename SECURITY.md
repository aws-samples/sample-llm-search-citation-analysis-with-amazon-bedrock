# Security

## Reporting Security Issues

If you discover a potential security issue in this project, please notify AWS Security via our [vulnerability reporting page](http://aws.amazon.com/security/vulnerability-reporting/).

**Please do not create a public GitHub issue.**

## Security controls

What the deployed stack does, as defined in `lib/citation-analysis-stack.ts`, `lib/constructs/auth.ts` and `lambda/shared/`.

### Authentication and authorization (Amazon Cognito)

- **Admin-invited users only.** Self sign-up is disabled (`selfSignUpEnabled: false`) and the dashboard's Amplify `Authenticator` hides the sign-up form (`hideSignUp`). Users sign in with their email address, which is verified; new users receive an invitation email with a temporary password.
- **Password policy:** at least 8 characters with lowercase, uppercase, digits and symbols. Account recovery is by email only.
- **Tokens:** access and ID tokens last 1 hour, refresh tokens 7 days, so disabling a user takes effect within an hour. The app client has no secret. Amplify keeps the tokens in its default browser storage (`localStorage`) and sends the ID token in the `Authorization` header.
- **Not configured:** MFA, and Cognito threat protection (the user pool is on the Essentials feature plan).
- **Identity pool:** unauthenticated identities are disabled, and the unauthenticated role explicitly denies every action.
- **API authorizer:** a Cognito user pool authorizer protects every API Gateway method except `GET /api/health` and the CORS preflight (`OPTIONS`) methods.
- **Roles:** two groups, `Admin` and `Users`. Admin-only operations are enforced in the Lambda handlers by `@require_group(ADMIN_GROUP)` (`lambda/shared/auth.py`), which checks the `cognito:groups` claim: user management, starting analysis runs, provider settings and API keys, changes to the brand configuration, personas and schedules, and alert settings, acknowledgements and content-change markers. Every other route (including keyword and keyword-group edits, keyword research and Content Studio) is open to any signed-in user.

### Network exposure

The only inbound endpoints are the CloudFront distribution (dashboard), the API Gateway REST API (`prod` stage) and the Cognito user pool endpoints. There is no VPC, no Lambda function URL and no public S3 bucket. The crawler's Bedrock AgentCore browser uses the public network mode to reach cited pages (outbound only).

- **CloudFront:** redirects HTTP to HTTPS and reads the web bucket through Origin Access Control. It uses the default `*.cloudfront.net` certificate (no custom domain). The response headers policy sets:
  - `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.amazonaws.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none';`
  - `Strict-Transport-Security` for one year, including subdomains
  - `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-XSS-Protection: 1; mode=block`
- **API Gateway:** the stage throttle is 100 requests per second with a burst of 200. A usage plan with the same throttle and a 10,000 requests/day quota is attached to the stage; quotas are counted per API key and no method requires one. Most API Lambdas are capped at the 29-second integration timeout.
- **CORS:** API Gateway answers preflight requests for any origin, without credentials. Lambda responses allow only the CloudFront origin, read from the SSM parameter `/citation-analysis/cors-origin` (plus `localhost:3000` and `localhost:5173` when deployed with `-c dev=true`). If the parameter cannot be read, the response carries an empty `Access-Control-Allow-Origin`. Gateway error responses (401, 403, 504, 5xx) also name only the CloudFront origin (`*` in dev mode).

### AWS WAF

The stack declares two web ACLs. API Gateway has no web ACL; it relies on the authorizer, the stage throttle and validation in the handlers.

| Web ACL | Attached to | Rules |
|---|---|---|
| `CitationAnalysis-CloudFront-WAF` (scope `CLOUDFRONT`, us-east-1) | CloudFront distribution | AWS Common rule set, AWS Known Bad Inputs, rate limit 1,000 requests per IP per 5 minutes (block) |
| Regional web ACL (`lib/constructs/auth.ts`) | Cognito user pool | Rate limit 3,000 requests per IP per 5 minutes (block); AWS Common and Bot Control rule sets in count mode; Known Bad Inputs (block); Unix (`UNIXShellCommandsVariables_BODY` counted) and SQLi (`SQLi_BODY` counted) rule sets |

The CloudFront web ACL is created by a custom resource (`CitationAnalysis-CloudFrontWafHandler`, boto3 `wafv2`) because CloudFront ACLs must live in us-east-1. The handler only recreates the ACL when its name changes, so editing its rules in code does not update an ACL that already exists. Neither ACL has WAF logging; both publish CloudWatch metrics and sampled requests.

### Data protection

- **DynamoDB:** every table uses AWS-managed encryption, point-in-time recovery and a `RETAIN` removal policy.
- **S3:** every bucket (keywords, screenshots, raw responses, web, access logs) uses S3-managed encryption, blocks all public access, rejects non-TLS requests and is retained on stack deletion. Versioning is off. Server access logs go to `citation-analysis-access-logs-<account>` and expire after 90 days. Screenshots move to Infrequent Access after 90 days and are not deleted.
- **Messaging:** the KPI alerts SNS topic is encrypted with the AWS-managed key `alias/aws/sns`, and the Content Studio SQS queue uses SQS-managed encryption and requires TLS.
- **Logging:** application Lambda log groups keep 30 days. API Gateway publishes per-method CloudWatch metrics but writes no access or execution logs, and data tracing (full request and response bodies) is deliberately off.

### Secrets

- Provider API keys live in AWS Secrets Manager under `citation-analysis/<name>-key`, where `<name>` is one of `openai`, `perplexity`, `gemini`, `claude`, `brave`, `tavily`, `exa`, `serpapi` or `firecrawl`. The stack imports these secrets and never creates them. Bedrock calls use IAM, not a key.
- A secret may hold the raw key or JSON with an `api_key` field; an empty value or `placeholder` counts as not configured.
- Lambdas read keys at invocation time (`lambda/shared/secrets.py`) and cache them for 5 minutes, so a rotated key is picked up without redeploying. Lookup failures log the exception type only, never the value.
- Admins can create or update keys from **Settings > AI Providers**. The configuration Lambda may create, update and read secrets under `citation-analysis/*`.

### IAM

Each Lambda has its own role, scoped to the tables, buckets, secrets and state machines it uses; most grants name exact resource ARNs. These statements use wider resources:

- `bedrock:InvokeModel` on `anthropic.claude-*` foundation models and `global.anthropic.claude-*` inference profiles in any region (required for global cross-region inference)
- `lambda:InvokeFunction` on `CitationAnalysis-*` for the Step Functions role
- `scheduler:ListSchedules` on `*` (the action supports no resource scoping)
- `wafv2:CreateWebACL`, `DeleteWebACL`, `GetWebACL` and `UpdateWebACL` on `*`, for the CloudFront WAF custom resource
- Bedrock model-access and Marketplace actions on `*` (`bedrock:PutUseCaseForModelAccess`, `GetFoundationModelAvailability`, `ListFoundationModelAgreementOffers`, `CreateFoundationModelAgreement`; `aws-marketplace:ViewSubscriptions` and `Subscribe` only when called via Bedrock), held by the deploy-time `BedrockModelAccess` functions only, not by runtime roles

The crawler's AgentCore permissions (`StartBrowserSession`, `StopBrowserSession`, `ConnectBrowserAutomationStream`) are scoped to the stack's own browser.

### Application

- **HTML rendering:** AI answers are formatted by `components/ui/MarkdownProcessor.tsx`, which sanitizes the HTML it builds with DOMPurify before rendering it; it is the only use of `dangerouslySetInnerHTML`. Content Studio output is rendered with `react-markdown`, which does not render raw HTML.
- **Input validation:** the `@validate` and `@paginate` decorators (`lambda/shared/decorators.py`) enforce types and length limits, clamp page sizes, and reduce sort fields to letters, digits and underscores. User text placed in model prompts is truncated and delimited (`lambda/shared/prompt_safety.py`).
- **Errors:** handlers log the full exception server-side and return a generic message to the client (`lambda/shared/api_response.py`).

## Dependencies

- Run `npm audit` in the repo root and in `web/` before a release. Both `package.json` files pin vulnerable transitive packages through `overrides`.
- The shared layer (`lambda/layer/requirements.txt`) takes minimum versions, resolved when the layer is built; the crawler layer (`lambda/crawler-layer/requirements.txt`) pins exact versions, including its own boto3. Rebuild the layers to pick up fixes.
- Third-party licenses are listed in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## Before deploying to production

- [ ] Provider API keys are in Secrets Manager (`citation-analysis/*`) and not in source, `.env` files or CDK context
- [ ] The stack is deployed without `-c dev=true` (dev mode allows localhost and wildcard CORS)
- [ ] Only the intended users exist in the Cognito user pool, and only administrators are in `Admin`
- [ ] You have decided whether you need MFA, Cognito threat protection, WAF logging or API Gateway access logs; none is enabled by default
- [ ] `npm audit` (root and `web/`) shows no unaddressed high or critical findings
