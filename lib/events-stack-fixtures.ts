import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { allowStatementsOfRole, findFunctionRoleLogicalId, resolvePath, statementActions } from './citation-analysis-stack-fixtures';
import { CitationAnalysisEventsStack, OWN_CHANNEL_ONLY_HANDLER } from './events-stack';
import { removeScratchTree, writeScratchTree } from './scratch-tree-fixtures';

/** The events stack on its own, environment-agnostic like the other stack specs. */
export function synthesizeEventsTemplate(): Template {
  const app = new cdk.App();
  return Template.fromStack(new CitationAnalysisEventsStack(app, 'EventsStackTest'));
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

/** The context fields the user namespace's `onSubscribe` reads, for a caller `sub` subscribing to `channel`. */
export function subscribeContext(channel: string, sub: string | null): unknown {
  return {
    info: { channel: { path: channel, segments: channel.split('/').filter(Boolean) } },
    identity: sub === null ? null : { sub, issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_pool' },
  };
}

/**
 * `OWN_CHANNEL_ONLY_HANDLER` exactly as deployed, imported as a module from a temporary directory whose
 * `@aws-appsync/utils` is a stub: `util.unauthorized()` throws `Unauthorized`, as it ends the request in AppSync.
 * The directory is removed once the module is loaded.
 */
export async function importOwnChannelHandler(): Promise<{ onSubscribe: (ctx: unknown) => void }> {
  const dir = writeScratchTree('appsync-js-', {
    'node_modules/@aws-appsync/utils/package.json': JSON.stringify({ name: '@aws-appsync/utils', type: 'module', main: 'index.js' }),
    'node_modules/@aws-appsync/utils/index.js': "export const util = { unauthorized() { throw new Error('Unauthorized'); } };\n",
    'package.json': JSON.stringify({ type: 'module' }),
    'own-channel-only.js': OWN_CHANNEL_ONLY_HANDLER,
  });
  const file = join(dir, 'own-channel-only.js');
  try {
    return await (import(pathToFileURL(file).href) as Promise<{ onSubscribe: (ctx: unknown) => void }>);
  } finally {
    // The imported modules stay loaded; the files are only needed for the import.
    removeScratchTree(dir);
  }
}
