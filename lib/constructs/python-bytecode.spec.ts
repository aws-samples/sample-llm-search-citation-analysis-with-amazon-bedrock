import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  beforeAll, describe, expect, it
} from 'vitest';
import {
  BUILT_SHARED_DIR, assetHashesAroundEdit, bytecodeTags, listFiles, pycFlags, synthesizePythonAssets,
  writePycHeader, type SynthesizedPythonAssets
} from './python-bytecode-fixtures';
import { bytecodePath, bytecodeProblem, pythonSourceHash } from './python-bytecode';
import { bytecodeProblems } from './python-layer';

const CPYTHON_312_MAGIC = [0xcb, 0x0d, 0x0d, 0x0a];
const CHECKED_HASH_FLAGS = 3;
const UNCHECKED_HASH_FLAGS = 1;

describe('pythonSourceHash', () => {
  // Expected values: `importlib.util.source_hash(...)` printed by CPython 3.12.12.
  it.each([
    ['empty source', Buffer.alloc(0), 'baf18eedc9387a25'],
    ['one byte', Buffer.from('a'), '8724e43a54b7eb49'],
    ['a partial final word', Buffer.from('print(1)\n'), 'bf71f361a5f8cd69'],
    ['whole words only', Buffer.from(Array.from({ length: 64 }, (_, index) => index)), '97b52f513d2348d8'],
  ])('matches CPython 3.12 importlib.util.source_hash for %s', (_label, source, expected) => {
    expect(pythonSourceHash(source).toString('hex')).toBe(expected);
  });
});

describe('bytecodeProblem', () => {
  const modelsSource = path.join(BUILT_SHARED_DIR, 'models.py');

  it('accepts the built layer bytecode of an unchanged module', () => {
    expect(bytecodeProblem(bytecodePath(modelsSource), fs.readFileSync(modelsSource))).toBeUndefined();
  });

  it('reports stale bytecode when the source no longer matches the embedded hash', () => {
    const edited = Buffer.concat([fs.readFileSync(modelsSource), Buffer.from('\n# edited\n')]);
    expect(bytecodeProblem(bytecodePath(modelsSource), edited)).toBe('stale');
  });

  it('reports missing bytecode when no cpython-312 file exists', () => {
    expect(bytecodeProblem('/nonexistent/__pycache__/x.cpython-312.pyc', Buffer.from(''))).toBe('missing');
  });

  it('reports timestamp-based bytecode as stale', () => {
    expect(bytecodeProblem(writePycHeader(CPYTHON_312_MAGIC, 0), Buffer.from(''))).toBe('stale');
  });

  it('reports another CPython version as stale', () => {
    const cpython314Magic = [0x2b, 0x0e, 0x0d, 0x0a];
    expect(bytecodeProblem(writePycHeader(cpython314Magic, CHECKED_HASH_FLAGS), Buffer.from(''))).toBe('stale');
  });
});

describe('bytecodeProblems', () => {
  it('reports nothing for the current layer build', () => {
    const sourceShared = path.join(BUILT_SHARED_DIR, '../../../shared');
    expect(bytecodeProblems(sourceShared, BUILT_SHARED_DIR, ['models.py', 'auth.py'])).toStrictEqual([]);
  });

  it('names modules whose bytecode was never built', () => {
    expect(bytecodeProblems(path.join(BUILT_SHARED_DIR, '../../../shared'), '/nonexistent', ['models.py']))
      .toStrictEqual(['no cpython-312 bytecode for models.py']);
  });

  it('names the first five modules and counts the rest when many lack bytecode', () => {
    const names = ['auth.py', 'config.py', 'cursors.py', 'models.py', 'router.py', 'secrets.py', 'utils.py'];
    expect(bytecodeProblems(path.join(BUILT_SHARED_DIR, '../../../shared'), '/nonexistent', names))
      .toStrictEqual(['no cpython-312 bytecode for auth.py, config.py, cursors.py, models.py, router.py and 2 more']);
  });
});

describe('synthesized Python assets', () => {
  const assets: SynthesizedPythonAssets = { layer: '', worker: '', api: '' };

  beforeAll(() => {
    Object.assign(assets, synthesizePythonAssets());
  }, 60_000);

  it('ships checked-hash cpython-312 bytecode for the shared layer modules', () => {
    expect(pycFlags(path.join(assets.layer, 'python/shared/__pycache__/models.cpython-312.pyc')))
      .toBe(CHECKED_HASH_FLAGS);
  });

  it('ships unchecked-hash cpython-312 bytecode for third-party layer packages', () => {
    expect(pycFlags(path.join(assets.layer, 'python/requests/__pycache__/api.cpython-312.pyc')))
      .toBe(UNCHECKED_HASH_FLAGS);
  });

  it('ships no bytecode of other Python versions in the layer', () => {
    expect(bytecodeTags(listFiles(assets.layer))).toStrictEqual(['cpython-312']);
  });

  it('ships a worker directory as its runtime files plus checked-hash bytecode', () => {
    expect(listFiles(assets.worker)).toStrictEqual(['__pycache__/handler.cpython-312.pyc', 'handler.py']);
    expect(pycFlags(path.join(assets.worker, '__pycache__/handler.cpython-312.pyc'))).toBe(CHECKED_HASH_FLAGS);
  });

  it('ships only the listed API handler files with their bytecode', () => {
    expect(listFiles(assets.api)).toStrictEqual([
      '__pycache__/get-stats.cpython-312.pyc',
      '__pycache__/stats-insights.cpython-312.pyc',
      'get-stats.py',
      'stats-insights.py',
    ]);
  });
});

describe('compiledPythonCode asset hash', () => {
  it('stays the same when a file the asset does not ship changes', () => {
    const { before, after } = assetHashesAroundEdit('other.py', 'VALUE = 2\n', ['handler.py']);
    expect(after).toBe(before);
  });

  it('changes when a shipped file changes', () => {
    const { before, after } = assetHashesAroundEdit('handler.py', 'def handler(event, context):\n    return 2\n', ['handler.py']);
    expect(after).not.toBe(before);
  });

  it('ignores test files of a directory asset', () => {
    const { before, after } = assetHashesAroundEdit('test_handler.py', 'def test_other():\n    assert True\n');
    expect(after).toBe(before);
  });
});
