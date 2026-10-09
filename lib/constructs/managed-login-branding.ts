import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

/**
 * Themes the Cognito managed-login pages an MCP client's browser lands on
 * (`/oauth2/authorize`, the Allow/Cancel consent screen, `/oauth2/token`'s
 * error pages) to the dashboard's palette, instead of Cognito's own
 * default style.
 *
 * `CfnManagedLoginBranding`'s `settings` is an opaque `Document` whose full
 * schema Cognito does not publish; AWS's own guidance for customizing it
 * outside the console branding editor is to describe the *default* style
 * Cognito already generated, patch only the known keys, and send that back
 * (https://docs.aws.amazon.com/cognito/latest/developerguide/managed-login-brandingeditor.html#branding-tools):
 * "Amazon Cognito ignores any values in your Settings object that aren't in
 * the schema that you receive in your API response." Hand-authoring the
 * object from scratch risks a key Cognito silently drops or a shape it
 * rejects outright.
 *
 * This construct runs that round trip at deploy time, in one Lambda behind
 * a `cr.Provider` (same shape as `BedrockModelAccess`):
 *   1. `CreateManagedLoginBranding` with Cognito's own defaults
 *      (`useCognitoProvidedValues: true`) — this is the only call that is
 *      guaranteed to produce a settings document the service accepts.
 *   2. `DescribeManagedLoginBrandingByClient` with `returnMergedResources:
 *      true` to read that document back in full.
 *   3. Patch the handful of colour / radius / logo keys this app cares
 *      about and `UpdateManagedLoginBranding` with the merged result.
 * `Update`/`Delete` on the custom resource re-run steps 2–3 (or do nothing,
 * for Delete — the style is deleted with the app client it belongs to).
 */

const HEADER_HEX = '#111827'; // gray-900: sidebar, header, primary buttons, dashboard login screen
const SURFACE_HEX = '#ffffff'; // white: light-mode form background
const DARK_SURFACE_HEX = '#1f2937'; // gray-800: dark-mode form background (Login's dark:bg-gray-900 page / gray-800 card)
const DARK_PAGE_HEX = '#111827'; // gray-900: dark-mode page background
const LIGHT_PAGE_HEX = '#f9fafb'; // gray-50: light-mode page background
const BORDER_HEX = '#e5e7eb'; // gray-200
const TEXT_LIGHT_HEX = '#111827'; // gray-900
const TEXT_DARK_HEX = '#f9fafb'; // gray-50
const LINK_HEX = '#2563eb'; // blue-600, matches the dashboard's email templates
const BORDER_RADIUS_PX = 8; // Tailwind `rounded-lg`, the app's default control radius

/**
 * The sidebar's bar-chart mark (`CHART_BAR_PATHS` in
 * `web/src/components/ui/iconPaths.ts`) inside the same `bg-gray-900` /
 * `bg-white` square used in `Layout/Sidebar.tsx`, so the managed-login
 * header logo is the same mark the dashboard shows once signed in.
 */
function logoSvg(squareHex: string, strokeHex: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" rx="8" fill="${squareHex}"/>` +
    `<path d="M11.5 23.5v-7.2a1.6 1.6 0 0 0-1.6-1.6H8.3a1.6 1.6 0 0 0-1.6 1.6v7.2a1.6 1.6 0 0 0 1.6 1.6h1.6a1.6 1.6 0 0 0 1.6-1.6zm0 0v-11.6a1.6 1.6 0 0 1 1.6-1.6h1.6a1.6 1.6 0 0 1 1.6 1.6v11.6m-4.8 0a1.6 1.6 0 0 0 1.6 1.6h1.6a1.6 1.6 0 0 0 1.6-1.6m0 0V8.3a1.6 1.6 0 0 1 1.6-1.6h1.6a1.6 1.6 0 0 1 1.6 1.6v15.2a1.6 1.6 0 0 1-1.6 1.6h-1.6a1.6 1.6 0 0 1-1.6-1.6z"` +
    ` fill="none" stroke="${strokeHex}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  );
}

/** Inline handler, kept dependency-free like `agreementHandlerCode` in `bedrock-model-access.ts`. */
function brandingHandlerCode(): string {
  return `
import base64
import json
import logging

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

PHYSICAL_ID_PREFIX = 'mcp-managed-login-branding-'


def _physical_id(client_id):
    return f'{PHYSICAL_ID_PREFIX}{client_id}'


def _rgba(hex_colour):
    """Cognito stores colours as 8 hex digits (RGBA) without a hash: '#111827' -> '111827ff'."""
    return f"{hex_colour.lstrip('#').lower()}ff"


def _patch(settings, path, value):
    """Set a leaf that already exists in Cognito's document; a missing key is a schema drift, logged and skipped.

    Only existing keys are patched: Cognito rejects any property outside its
    schema (UnknownProperty), so an invented key would fail the whole update.
    """
    node = settings
    for key in path[:-1]:
        node = node.get(key) if isinstance(node, dict) else None
        if node is None:
            logger.warning('Settings schema has no %s; skipping', '.'.join(path))
            return
    if not isinstance(node, dict) or path[-1] not in node:
        logger.warning('Settings schema has no %s; skipping', '.'.join(path))
        return
    node[path[-1]] = value


def _apply_theme(settings, theme):
    """Patch only the keys this app themes; every other Cognito default is left untouched.

    Paths follow the document DescribeManagedLoginBrandingByClient returns
    (components.*.lightMode/darkMode, componentClasses.link.*): read from a
    live user pool on 2026-10-09.
    """
    header, surface, dark_surface = _rgba(theme['header']), _rgba(theme['lightSurface']), _rgba(theme['darkSurface'])
    link, border = _rgba(theme['link']), _rgba(theme['border'])
    radius = float(theme['radius'])
    components = [
        (['components', 'pageBackground', 'lightMode', 'color'], _rgba(theme['lightPage'])),
        (['components', 'pageBackground', 'darkMode', 'color'], _rgba(theme['darkPage'])),
        (['components', 'form', 'lightMode', 'backgroundColor'], surface),
        (['components', 'form', 'lightMode', 'borderColor'], border),
        (['components', 'form', 'darkMode', 'backgroundColor'], dark_surface),
        (['components', 'form', 'borderRadius'], radius),
        (['components', 'pageHeader', 'lightMode', 'background', 'color'], surface),
        (['components', 'pageHeader', 'lightMode', 'borderColor'], border),
        (['components', 'pageHeader', 'darkMode', 'background', 'color'], dark_surface),
        (['components', 'pageHeader', 'logo', 'enabled'], True),
        (['components', 'form', 'logo', 'enabled'], True),
        (['components', 'pageText', 'lightMode', 'headingColor'], _rgba(theme['textLight'])),
        (['components', 'pageText', 'darkMode', 'headingColor'], _rgba(theme['textDark'])),
    ]
    for mode, background, text in (('lightMode', header, surface), ('darkMode', surface, header)):
        for state in ('defaults', 'hover', 'active'):
            components.append((['components', 'primaryButton', mode, state, 'backgroundColor'], background))
            components.append((['components', 'primaryButton', mode, state, 'textColor'], text))
    classes = [
        (['componentClasses', 'link', 'lightMode', 'defaults', 'textColor'], link),
        (['componentClasses', 'link', 'lightMode', 'hover', 'textColor'], header),
        (['componentClasses', 'link', 'darkMode', 'defaults', 'textColor'], link),
        (['componentClasses', 'focusState', 'lightMode', 'borderColor'], link),
        (['componentClasses', 'buttons', 'borderRadius'], radius),
        (['componentClasses', 'input', 'borderRadius'], radius),
    ]
    for path, value in components + classes:
        _patch(settings, path, value)


def _logo_assets(logo_light_bytes, logo_dark_bytes):
    assets = []
    for category in ('PAGE_HEADER_LOGO', 'FORM_LOGO'):
        for color_mode, data in (('LIGHT', logo_light_bytes), ('DARK', logo_dark_bytes)):
            assets.append({
                'Category': category,
                'ColorMode': color_mode,
                'Extension': 'SVG',
                'Bytes': data,
            })
    return assets


def handler(event, context):
    request_type = event.get('RequestType', '')
    properties = event.get('ResourceProperties', {})
    user_pool_id = properties['userPoolId']
    client_id = properties['clientId']
    theme = json.loads(properties['theme'])
    # The resource properties carry the SVGs base64-encoded (CloudFormation
    # properties are text); boto3 encodes the Bytes field itself, so hand it
    # the raw bytes or Cognito receives ASCII and answers "Media type not supported".
    logo_light_bytes = base64.b64decode(properties['logoLightBase64'])
    logo_dark_bytes = base64.b64decode(properties['logoDarkBase64'])

    cognito = boto3.client('cognito-idp')
    physical_id = _physical_id(client_id)

    if request_type == 'Delete':
        # The style is tied to the app client and is removed with it
        # (or with the stack's rollback of the Create); nothing to clean
        # up here that would outlive the client.
        return {'PhysicalResourceId': physical_id}

    if request_type == 'Create':
        try:
            cognito.create_managed_login_branding(
                UserPoolId=user_pool_id,
                ClientId=client_id,
                UseCognitoProvidedValues=True,
            )
            logger.info('Created default managed-login branding for client %s', client_id)
        except cognito.exceptions.ManagedLoginBrandingExistsException as error:
            # A style already exists for this client (set up in the console,
            # or a re-run after a partial failure); fall through to the
            # describe/patch below, which themes whatever is there.
            logger.info('Default branding already exists for %s: %s', client_id, error)

    described = cognito.describe_managed_login_branding_by_client(
        UserPoolId=user_pool_id,
        ClientId=client_id,
        ReturnMergedResources=True,
    )
    branding = described['ManagedLoginBranding']
    settings = branding.get('Settings', {})
    _apply_theme(settings, theme)

    try:
        cognito.update_managed_login_branding(
            UserPoolId=user_pool_id,
            ManagedLoginBrandingId=branding['ManagedLoginBrandingId'],
            Settings=settings,
            Assets=_logo_assets(logo_light_bytes, logo_dark_bytes),
            UseCognitoProvidedValues=False,
        )
        logger.info('Applied Citation Analysis theme to managed-login branding for client %s', client_id)
    except ClientError as error:
        # A malformed settings key is a defect in this handler's _apply_theme
        # map, not an account-state problem like the Bedrock agreements this
        # pattern mirrors; surface it rather than deploying an unthemed page.
        logger.error('UpdateManagedLoginBranding failed for %s: %s', client_id, error)
        raise

    return {'PhysicalResourceId': physical_id}
`;
}

export interface ManagedLoginBrandingProps {
  readonly userPoolId: string;
  readonly clientId: string;
  /** The branding style must exist before this construct can describe/patch it. */
  readonly domainDependency: Construct;
}

/** Themes the mcp app client's managed-login pages; see the module doc comment. */
export class ManagedLoginBranding extends Construct {
  /**
   * The deploy-time custom resource that applies the theme. Callers depend on
   * it so the login URL is not advertised before its pages are themed.
   */
  public readonly resource: cdk.CustomResource;

  constructor(scope: Construct, id: string, props: ManagedLoginBrandingProps) {
    super(scope, id);

    const theme = {
      header: HEADER_HEX,
      lightSurface: SURFACE_HEX,
      darkSurface: DARK_SURFACE_HEX,
      lightPage: LIGHT_PAGE_HEX,
      darkPage: DARK_PAGE_HEX,
      border: BORDER_HEX,
      textLight: TEXT_LIGHT_HEX,
      textDark: TEXT_DARK_HEX,
      link: LINK_HEX,
      radius: BORDER_RADIUS_PX,
    };
    const logoLightBase64 = Buffer.from(logoSvg(HEADER_HEX, SURFACE_HEX)).toString('base64');
    const logoDarkBase64 = Buffer.from(logoSvg(SURFACE_HEX, HEADER_HEX)).toString('base64');

    const handlerFunction = new lambda.Function(this, 'Handler', {
      functionName: 'CitationAnalysis-McpBrandingHandler',
      description: 'Themes the MCP managed-login pages to the Citation Analysis dashboard palette',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromInline(brandingHandlerCode()),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logGroup: new logs.LogGroup(this, 'HandlerLogs', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });
    handlerFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:CreateManagedLoginBranding',
        'cognito-idp:DescribeManagedLoginBrandingByClient',
        'cognito-idp:UpdateManagedLoginBranding',
      ],
      resources: ['*'], // These operations do not accept a resource ARN.
    }));

    const provider = new cr.Provider(this, 'Provider', {
      onEventHandler: handlerFunction,
      logGroup: new logs.LogGroup(this, 'ProviderLogs', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    const resource = new cdk.CustomResource(this, 'Resource', {
      serviceToken: provider.serviceToken,
      properties: {
        userPoolId: props.userPoolId,
        clientId: props.clientId,
        theme: JSON.stringify(theme),
        logoLightBase64,
        logoDarkBase64,
      },
    });
    resource.node.addDependency(props.domainDependency);
    this.resource = resource;
  }
}
