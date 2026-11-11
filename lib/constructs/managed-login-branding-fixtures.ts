import { spawnSync } from 'node:child_process';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Construct } from 'constructs';

import { resolvePath } from '../citation-analysis-stack-fixtures';
import { removeScratchTree, writeScratchTree } from '../scratch-tree-fixtures';
import { ManagedLoginBranding } from './managed-login-branding';
import { extractBrandingHandlerCode } from './mcp-server-fixtures';
import { findPython312 } from './python-bytecode';

/** The construct alone in a stack, with plain-string pool and client ids. */
export function synthesizeBranding(): Template {
  const stack = new Stack(new App(), 'BrandingTest');
  new ManagedLoginBranding(stack, 'Branding', {
    userPoolId: 'eu-west-1_TestPool',
    clientId: 'test-client',
    domainDependency: new Construct(stack, 'Domain'),
  });
  return Template.fromStack(stack);
}

/** The custom resource's properties as the handler receives them (CloudFormation's `ServiceToken` aside). */
function extractResourceProperties(template: Template): Record<string, unknown> {
  const resources = template.findResources('AWS::CloudFormation::CustomResource');
  const properties = resolvePath(Object.values(resources)[0], ['Properties']) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(properties).filter(([key]) => key !== 'ServiceToken'));
}

/**
 * Stand-ins for boto3 and botocore: one Cognito client whose style either
 * exists or not, recording each call. `describe` answers
 * ResourceNotFoundException without a style, as the live service does.
 */
const FAKE_BOTO3 = `
import json, os
from botocore.exceptions import ClientError

CALLS = []

class _Exceptions:
    class ManagedLoginBrandingExistsException(ClientError):
        pass

class _Cognito:
    exceptions = _Exceptions

    def __init__(self):
        self.style = {'components': {'form': {'borderRadius': 0}}} if os.environ['STYLE_EXISTS'] == '1' else None

    def create_managed_login_branding(self, **kwargs):
        CALLS.append('create')
        if self.style is not None:
            raise _Exceptions.ManagedLoginBrandingExistsException('exists')
        self.style = {'components': {'form': {'borderRadius': 0}}}

    def describe_managed_login_branding_by_client(self, **kwargs):
        CALLS.append('describe')
        if self.style is None:
            raise ClientError('ResourceNotFoundException')
        return {'ManagedLoginBranding': {'ManagedLoginBrandingId': 'style-1', 'Settings': self.style}}

    def update_managed_login_branding(self, **kwargs):
        CALLS.append('update:radius=' + str(kwargs['Settings']['components']['form']['borderRadius']))

def client(name):
    return _Cognito()
`;

const FAKE_BOTOCORE_EXCEPTIONS = `
class ClientError(Exception):
    pass
`;

const DRIVER = `
import json, sys
import boto3, index
event = json.loads(sys.stdin.read())
try:
    index.handler(event, None)
    outcome = 'ok'
except Exception as error:
    outcome = type(error).__name__ + ': ' + str(error)
print(json.dumps({'calls': boto3.CALLS, 'outcome': outcome}))
`;

export interface HandlerRun {
  /** Cognito calls in order: `create`, `describe`, `update:radius=<patched form radius>`. */
  calls: string[];
  /** `ok`, or the exception the handler raised. */
  outcome: string;
}

/** Runs the synthesized inline handler under CPython 3.12 (the Lambda runtime) against the fake Cognito client. */
export function runBrandingHandler(template: Template, requestType: string, styleExists: boolean): HandlerRun {
  const python = findPython312();
  if (python === null) return { calls: [], outcome: 'CPython 3.12 not found (PYTHON312, python3.12, uv)' };
  const dir = writeScratchTree('branding-handler-', {
    'botocore/__init__.py': '',
    'botocore/exceptions.py': FAKE_BOTOCORE_EXCEPTIONS,
    'boto3.py': FAKE_BOTO3,
    'index.py': extractBrandingHandlerCode(template),
    'driver.py': DRIVER,
  });
  const event = { RequestType: requestType, ResourceProperties: extractResourceProperties(template) };
  const result = spawnSync(python, ['driver.py'], {
    cwd: dir,
    input: JSON.stringify(event),
    encoding: 'utf8',
    env: { ...process.env, STYLE_EXISTS: styleExists ? '1' : '0', PYTHONDONTWRITEBYTECODE: '1' },
  });
  removeScratchTree(dir);
  return JSON.parse(result.stdout || `{"calls":[],"outcome":${JSON.stringify(result.stderr)}}`) as HandlerRun;
}
