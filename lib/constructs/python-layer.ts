import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

/** Build caches never belong in a Lambda asset: running pytest rewrites them inside the `lambda/` source trees, which would otherwise change every asset hash and redeploy unchanged functions. */
export const PYTHON_ASSET_EXCLUDES = ['**/__pycache__', '**/*.pyc'];

/** The `lambda/` directory the Python assets are read from. */
const LAMBDA_ROOT = path.join(__dirname, '../../lambda');

/** The code asset of `lambda/<directory>`. */
export function lambdaSourceCode(directory: string): lambda.AssetCode {
  return lambda.Code.fromAsset(path.join(LAMBDA_ROOT, directory), { exclude: PYTHON_ASSET_EXCLUDES });
}

/**
 * Thrown at synth time when a Lambda layer's local build output is missing.
 * Layers must be built (scripts/deploy.sh or the per-layer build-layer.sh)
 * before `cdk synth`/`cdk deploy`.
 */
class LayerNotBuiltError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LayerNotBuiltError';
  }
}

/**
 * Fail synth when the built layer is missing shared modules that exist in
 * source.
 *
 * `lambda/layer/python/` is gitignored build output, and the existence check
 * alone passes against a *stale* build. Every handler imports `shared.*` from
 * this layer, so a module added to `lambda/shared/` without rebuilding
 * deploys cleanly and then ModuleNotFoundErrors on the first invocation of
 * every affected function — with nothing in the CDK output hinting why.
 *
 * This bit for real: `auth.py`, `safe_fetch.py` and `stale_jobs.py` were all
 * added to source while the built layer still held the previous set.
 */
function assertLayerMatchesSharedModules(
  builtSharedPath: string,
  layerName: string,
  buildCommand: string
): void {
  const sourceSharedPath = path.join(LAMBDA_ROOT, 'shared');
  if (!fs.existsSync(sourceSharedPath)) return;

  const expected = fs
    .readdirSync(sourceSharedPath)
    .filter((name) => name.endsWith('.py') && !name.startsWith('test_'));
  const built = fs.existsSync(builtSharedPath) ? fs.readdirSync(builtSharedPath) : [];
  const missing = expected.filter((name) => !built.includes(name));
  const stale = expected.filter((name) => (
    built.includes(name)
    && !fs.readFileSync(path.join(sourceSharedPath, name))
      .equals(fs.readFileSync(path.join(builtSharedPath, name)))
  ));

  if (missing.length === 0 && stale.length === 0) return;

  const problems = [
    ...(missing.length > 0 ? [`missing ${missing.join(', ')}`] : []),
    ...(stale.length > 0 ? [`outdated ${stale.join(', ')}`] : []),
  ].join('; ');
  throw new LayerNotBuiltError(
    `${layerName} layer is stale — ${problems}.\n` +
    'Every Lambda imports these files from its deployed layer.\n' +
    `Run: ${buildCommand}\n` +
    'Or use scripts/deploy.sh which builds all layers automatically.'
  );
}

/** Python layer build output; synth fails when it is missing or stale against `lambda/shared/`. */
interface PythonLayerSpec {
  /** Directory under `lambda/` holding `build-layer.sh` and the built `python/`. */
  directory: string;
  /** Layer label used in the build error messages ("Shared", "Crawler"). */
  label: string;
  layerVersionName: string;
  description: string;
}

/**
 * A layer from its local build output, refusing to synthesize when the build
 * is absent (`python/` missing or empty) or stale (see
 * `assertLayerMatchesSharedModules`).
 *
 * Each stack that needs a layer builds its own version from the same asset
 * rather than importing another stack's: a layer version's ARN changes with
 * every rebuild, and CloudFormation refuses to update an exported value that
 * another stack imports ("Export … cannot be updated as it is in use by …").
 * The asset hash is the same, so the second version costs no extra upload.
 */
export function pythonLayer(scope: Construct, id: string, spec: PythonLayerSpec): lambda.LayerVersion {
  const buildCommand = `bash lambda/${spec.directory}/build-layer.sh`;
  const pythonPath = path.join(LAMBDA_ROOT, spec.directory, 'python');
  if (!fs.existsSync(pythonPath) || fs.readdirSync(pythonPath).length === 0) {
    throw new LayerNotBuiltError(
      `${spec.label} layer not built. Run: ${buildCommand}\n` +
      'Or use scripts/deploy.sh which builds all layers automatically.'
    );
  }
  assertLayerMatchesSharedModules(path.join(pythonPath, 'shared'), spec.label, buildCommand);
  return new lambda.LayerVersion(scope, id, {
    layerVersionName: spec.layerVersionName,
    code: lambdaSourceCode(spec.directory),
    compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
    description: spec.description,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
  });
}
