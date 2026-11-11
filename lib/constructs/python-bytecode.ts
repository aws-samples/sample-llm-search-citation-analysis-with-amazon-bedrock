import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as lambda from 'aws-cdk-lib/aws-lambda';

/**
 * CPython 3.12 bytecode for Lambda assets.
 *
 * `/var/task` and `/opt` are read-only on Lambda, so CPython cannot cache the
 * bytecode it compiles: a module shipped without its
 * `__pycache__/<name>.cpython-312.pyc` is recompiled on every cold start
 * (32-73% of a router's import time, ~1.5-3 s per cold start at 256 MB). The
 * layers are precompiled by their `build-layer.sh`; handler code is compiled
 * here, at bundling time, by a 3.12 interpreter (or inside the 3.12 bundling
 * image when none is installed). Only 3.12 bytecode counts: the magic number
 * is per minor version and the runtime silently ignores any other.
 */

/** The tag CPython 3.12 writes into `__pycache__` file names. */
export const PYTHON_BYTECODE_TAG = 'cpython-312';

/** `importlib.util.MAGIC_NUMBER` of CPython 3.12 (3531, then `\r\n`). */
const PYTHON_312_MAGIC = Buffer.from([0xcb, 0x0d, 0x0d, 0x0a]);

/** pyc header flag: the file is validated by a source hash, not an mtime (PEP 552). */
const HASH_BASED_FLAG = 0b01;

const MASK_64 = (1n << 64n) - 1n;

function rotl(value: bigint, bits: bigint): bigint {
  return ((value << bits) | (value >> (64n - bits))) & MASK_64;
}

/** SipHash-1-3 state: v0..v3. */
type SipState = [bigint, bigint, bigint, bigint];

function sipRound(v: SipState): void {
  v[0] = (v[0] + v[1]) & MASK_64; v[1] = rotl(v[1], 13n) ^ v[0]; v[0] = rotl(v[0], 32n);
  v[2] = (v[2] + v[3]) & MASK_64; v[3] = rotl(v[3], 16n) ^ v[2];
  v[0] = (v[0] + v[3]) & MASK_64; v[3] = rotl(v[3], 21n) ^ v[0];
  v[2] = (v[2] + v[1]) & MASK_64; v[1] = rotl(v[1], 17n) ^ v[2]; v[2] = rotl(v[2], 32n);
}

function absorb(v: SipState, word: bigint): void {
  v[3] ^= word;
  sipRound(v);
  v[0] ^= word;
}

/**
 * `importlib.util.source_hash(source)` of CPython 3.12: SipHash-1-3 keyed with
 * the magic number (k0) and 0 (k1), as 8 little-endian bytes. A hash-based
 * pyc stores it at bytes 8-16, so comparing the two detects stale bytecode.
 */
export function pythonSourceHash(source: Buffer): Buffer {
  const k0 = BigInt(PYTHON_312_MAGIC.readUInt32LE(0));
  const v: SipState = [
    k0 ^ 0x736f6d6570736575n,
    0x646f72616e646f6dn,
    k0 ^ 0x6c7967656e657261n,
    0x7465646279746573n,
  ];
  const fullWords = Math.floor(source.length / 8);
  for (const index of Array.from({ length: fullWords }, (_, word) => word)) {
    absorb(v, source.readBigUInt64LE(index * 8));
  }
  const tail = source.subarray(fullWords * 8);
  const last = tail.reduce(
    (word, byte, offset) => word | (BigInt(byte) << BigInt(8 * offset)),
    BigInt(source.length & 0xff) << 56n
  );
  absorb(v, last);
  v[2] ^= 0xffn;
  sipRound(v);
  sipRound(v);
  sipRound(v);
  const digest = Buffer.alloc(8);
  digest.writeBigUInt64LE((v[0] ^ v[1] ^ v[2] ^ v[3]) & MASK_64);
  return digest;
}

/** The 3.12 bytecode path CPython looks up for `<dir>/<name>.py`. */
export function bytecodePath(sourceFile: string): string {
  const { dir, name } = path.parse(sourceFile);
  return path.join(dir, '__pycache__', `${name}.${PYTHON_BYTECODE_TAG}.pyc`);
}

/** Why the shipped bytecode of `source` would not be used, or undefined when it is current. */
export function bytecodeProblem(pycFile: string, source: Buffer): 'missing' | 'stale' | undefined {
  if (!fs.existsSync(pycFile)) return 'missing';
  const header = fs.readFileSync(pycFile).subarray(0, 16);
  const current = header.length === 16
    && header.subarray(0, 4).equals(PYTHON_312_MAGIC)
    && (header.readUInt32LE(4) & HASH_BASED_FLAG) === HASH_BASED_FLAG
    && header.subarray(8, 16).equals(pythonSourceHash(source));
  return current ? undefined : 'stale';
}

const PYTHON_312_CHECK = 'import sys; sys.exit(0 if sys.version_info[:2] == (3, 12) else 1)';

function isPython312(command: string): boolean {
  return spawnSync(command, ['-c', PYTHON_312_CHECK], { stdio: 'ignore' }).status === 0;
}

/** The absolute path of `command` on PATH, so the interpreter that runs is the one that was checked. */
function onPath(command: string): string | undefined {
  return (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter((dir) => path.isAbsolute(dir))
    .map((dir) => path.join(dir, command))
    .find((candidate) => fs.existsSync(candidate));
}

function uvPython312(): string | undefined {
  const uv = onPath('uv');
  if (uv === undefined) return undefined;
  const found = spawnSync(uv, ['python', 'find', '--no-project', '3.12'], { encoding: 'utf8' });
  return found.status === 0 ? found.stdout.trim() : undefined;
}

const python312: { found?: string | null } = {};

/** A CPython 3.12 on this machine: `$PYTHON312`, `python3.12` on PATH, or uv's. Null when there is none. */
export function findPython312(): string | null {
  if (python312.found !== undefined) return python312.found;
  const candidates = [process.env.PYTHON312, onPath('python3.12'), uvPython312()];
  python312.found = candidates.find((candidate): candidate is string => (
    candidate !== undefined && candidate !== '' && isPython312(candidate)
  )) ?? null;
  return python312.found;
}

const SKIPPED_DIRECTORIES = new Set(['__pycache__', '.pytest_cache', '.hypothesis', '.mypy_cache', '.ruff_cache']);

function isRuntimeFile(name: string): boolean {
  return !name.endsWith('.pyc') && !/^test_.*\.py$/.test(name) && name !== 'conftest.py' && name !== '.DS_Store';
}

/** Files under `directory` (relative, sorted) that run in Lambda: no tests, no caches. */
function runtimeFiles(directory: string, prefix = ''): string[] {
  return fs.readdirSync(path.join(directory, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const relative = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) return SKIPPED_DIRECTORIES.has(entry.name) ? [] : runtimeFiles(directory, relative);
      return isRuntimeFile(entry.name) ? [relative] : [];
    })
    .sort((left, right) => Number(left > right) - Number(left < right));
}

/** Content hash of the shipped files, so an edit to a file this asset does not ship cannot redeploy it. */
function filesHash(sourceDir: string, files: string[]): string {
  const hash = crypto.createHash('sha256').update(PYTHON_BYTECODE_TAG);
  for (const file of files) {
    hash.update(`\0${file}\0`).update(fs.readFileSync(path.join(sourceDir, file)));
  }
  return hash.digest('hex');
}

/**
 * `-d /var/task`: each code object records the file name it was compiled
 * from, which would otherwise be the temp dir (local) or `/asset-output`
 * (Docker), so the two paths gave different bytes. Lambda mounts the asset at
 * /var/task, so both now record the runtime path.
 */
const COMPILE_ARGS = ['-m', 'compileall', '-q', '--invalidation-mode', 'checked-hash', '-d', '/var/task'];

/** Thrown when CPython 3.12 rejects a handler file (a syntax error the runtime would hit on import). */
class BytecodeCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BytecodeCompileError';
  }
}

const compiledTrees = new Map<string, string>();
const removeCompiledTreesOnExit = { registered: false };

function copyFiles(sourceDir: string, files: string[], outputDir: string): void {
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(outputDir, file)), { recursive: true });
    fs.copyFileSync(path.join(sourceDir, file), path.join(outputDir, file));
  }
}

/**
 * The handler files plus their checked-hash bytecode, compiled once per
 * content hash per process (a test run synthesizes the stack many times).
 */
function compiledTree(python: string, sourceDir: string, files: string[], hash: string): string {
  const cached = compiledTrees.get(hash);
  if (cached !== undefined) return cached;
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'python312-asset-'));
  if (!removeCompiledTreesOnExit.registered) {
    removeCompiledTreesOnExit.registered = true;
    process.on('exit', () => compiledTrees.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
  }
  copyFiles(sourceDir, files, tree);
  const compiled = spawnSync(python, [...COMPILE_ARGS, tree], { encoding: 'utf8' });
  if (compiled.status !== 0) {
    throw new BytecodeCompileError(`CPython 3.12 could not compile ${sourceDir}:\n${compiled.stdout}${compiled.stderr}`);
  }
  compiledTrees.set(hash, tree);
  return tree;
}

function shellQuote(value: string): string {
  return ["'", value.replaceAll("'", "'\\''"), "'"].join('');
}

/** The Docker fallback: the same copy and compile inside the Lambda 3.12 bundling image. */
function dockerCommand(files: string[]): string[] {
  const copies = files.map((file) => {
    const source = shellQuote(path.posix.join('/asset-input', file));
    const target = shellQuote(path.posix.join('/asset-output', file));
    return `mkdir -p "$(dirname ${target})" && cp ${source} ${target}`;
  });
  return ['bash', '-c', [...copies, `python3.12 ${COMPILE_ARGS.join(' ')} /asset-output`].join(' && ')];
}

/**
 * The code asset of handler files from `sourceDir`, shipped with their
 * CPython 3.12 bytecode. `files` defaults to every runtime file of the
 * directory (tests and caches excluded). The asset hash covers only the
 * shipped files, so pytest caches and unrelated edits never redeploy it.
 */
export function compiledPythonCode(sourceDir: string, files: string[] = runtimeFiles(sourceDir)): lambda.Code {
  const assetHash = filesHash(sourceDir, files);
  return lambda.Code.fromAsset(sourceDir, {
    assetHash,
    bundling: {
      image: lambda.Runtime.PYTHON_3_12.bundlingImage,
      command: dockerCommand(files),
      local: {
        tryBundle(outputDir: string): boolean {
          const python = findPython312();
          if (python === null) {
            process.stderr.write('CPython 3.12 not found (PYTHON312, python3.12, uv); compiling handler bytecode in Docker.\n');
            return false;
          }
          fs.cpSync(compiledTree(python, sourceDir, files, assetHash), outputDir, { recursive: true });
          return true;
        },
      },
    },
  });
}
