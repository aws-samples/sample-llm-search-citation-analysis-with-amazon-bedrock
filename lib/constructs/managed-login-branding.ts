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


def _set_path(settings, path, value):
    """Set settings[path[0]][path[1]]... = value, creating intermediate dicts."""
    node = settings
    for key in path[:-1]:
        node = node.setdefault(key, {})
    node[path[-1]] = value


def _apply_theme(settings, theme):
    """Patch only the keys this app themes; every other Cognito default is left untouched."""
    # Component colours (categories vary by Cognito version; set every
    # location practitioner reports and the API reference describe so the
    # branding editor's own schema picks up whichever ones it defines).
    colour_paths = [
        (['components', 'pageBackground', 'light', 'backgroundColor'], theme['lightPage']),
        (['components', 'pageBackground', 'dark', 'backgroundColor'], theme['darkPage']),
        (['components', 'form', 'light', 'backgroundColor'], theme['lightSurface']),
        (['components', 'form', 'dark', 'backgroundColor'], theme['darkSurface']),
        (['components', 'form', 'light', 'borderColor'], theme['border']),
        (['components', 'form', 'light', 'borderRadius'], theme['radius']),
        (['components', 'primaryButton', 'light', 'backgroundColor'], theme['header']),
        (['components', 'primaryButton', 'light', 'textColor'], theme['lightSurface']),
        (['components', 'primaryButton', 'light', 'borderRadius'], theme['radius']),
        (['components', 'primaryButton', 'dark', 'backgroundColor'], theme['lightSurface']),
        (['components', 'primaryButton', 'dark', 'textColor'], theme['header']),
        (['components', 'globalHeader', 'light', 'backgroundColor'], theme['lightSurface']),
        (['components', 'globalHeader', 'dark', 'backgroundColor'], theme['darkSurface']),
        (['components', 'link', 'light', 'textColor'], theme['link']),
        (['components', 'link', 'dark', 'textColor'], theme['link']),
        (['components', 'pageText', 'light', 'textColor'], theme['textLight']),
        (['components', 'pageText', 'dark', 'textColor'], theme['textDark']),
    ]
    for path, value in colour_paths:
        try:
            _set_path(settings, path, value)
        except (TypeError, AttributeError):
            logger.warning('Could not set %s on this settings schema; skipping', '.'.join(path))


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
    logo_light_bytes = properties['logoLightBase64']
    logo_dark_bytes = properties['logoDarkBase64']

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
        except cognito.exceptions.InvalidParameterException as error:
            # A style already exists for this client (re-run after a partial
            # failure); fall through to the describe/patch below.
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
