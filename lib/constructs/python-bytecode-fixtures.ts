import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { compiledPythonCode } from './python-bytecode';
import { lambdaHandlerFilesCode, lambdaSourceCode, pythonLayer } from './python-layer';

/** The built shared layer, which the CDK specs already require. */
export const BUILT_SHARED_DIR = path.join(__dirname, '../../lambda/layer/python/shared');

/** Every file under `root`, relative and sorted. */
export function listFiles(root: string): string[] {
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))
    .sort((left, right) => Number(left > right) - Number(left < right));
}

/** The `cpython-NNN` tags of the `.pyc` files in `files`. */
export function bytecodeTags(files: string[]): string[] {
  return [...new Set(files.filter((file) => file.endsWith('.pyc')).map((file) => file.split('.').at(-2) ?? ''))];
}

/** The pyc header flags (bytes 4-8): 3 = checked-hash, 1 = unchecked-hash, 0 = timestamp. */
export function pycFlags(pycFile: string): number {
  return fs.readFileSync(pycFile).readUInt32LE(4);
}

/** A pyc header for `magic` and `flags` with an all-zero hash/mtime, written to a temp file. */
export function writePycHeader(magic: number[], flags: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyc-header-'));
  const file = path.join(dir, 'module.cpython-312.pyc');
  const header = Buffer.alloc(16);
  Buffer.from(magic).copy(header, 0);
  header.writeUInt32LE(flags, 4);
  fs.writeFileSync(file, header);
  return file;
}

/** The staged asset directory of every Lambda function and layer, by construct id. */
export interface SynthesizedPythonAssets {
  layer: string;
  worker: string;
  api: string;
}

/** The asset hash of a bound asset code (its S3 key is `<hash>.zip`). */
function assetHash(code: lambda.Code, scope: Construct): string {
  return path.parse(code.bind(scope).s3Location?.objectKey ?? '').name;
}

/** Synthesizes a shared layer, a worker directory and two API handler files, and returns their staged asset dirs. */
export function synthesizePythonAssets(): SynthesizedPythonAssets {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'PythonBytecodeTestStack');
  const layerVersion = pythonLayer(stack, 'Layer', {
    directory: 'layer',
    label: 'Shared',
    layerVersionName: 'test-shared',
    description: 'test',
  });
  const worker = assetHash(lambdaSourceCode('kpi-alerts'), new Construct(stack, 'Worker'));
  const api = assetHash(lambdaHandlerFilesCode('api', ['stats-insights.py', 'get-stats.py']), new Construct(stack, 'Api'));
  const layerContent = (layerVersion.node.defaultChild as lambda.CfnLayerVersion).content;
  const layer = path.parse((layerContent as lambda.CfnLayerVersion.ContentProperty).s3Key).name;
  const assemblyDir = app.synth().directory;
  return {
    layer: path.join(assemblyDir, `asset.${layer}`),
    worker: path.join(assemblyDir, `asset.${worker}`),
    api: path.join(assemblyDir, `asset.${api}`),
  };
}

/** A temp handler directory with `handler.py`, a sibling `other.py` and a test file. */
function writeHandlerDirectory(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'python-handler-'));
  fs.writeFileSync(path.join(dir, 'handler.py'), 'def handler(event, context):\n    return 1\n');
  fs.writeFileSync(path.join(dir, 'other.py'), 'VALUE = 1\n');
  fs.writeFileSync(path.join(dir, 'test_handler.py'), 'def test_value():\n    assert True\n');
  return dir;
}

/** The asset hash CDK gives `compiledPythonCode(dir, files)`. */
function compiledAssetHash(dir: string, files?: string[]): string {
  return assetHash(compiledPythonCode(dir, files), new cdk.Stack(new cdk.App(), 'HashStack'));
}

/** The asset hash of a fresh handler directory before and after `file` is rewritten with `content`. */
export function assetHashesAroundEdit(file: string, content: string, files?: string[]): { before: string; after: string } {
  const dir = writeHandlerDirectory();
  const before = compiledAssetHash(dir, files);
  fs.writeFileSync(path.join(dir, file), content);
  return { before, after: compiledAssetHash(dir, files) };
}
