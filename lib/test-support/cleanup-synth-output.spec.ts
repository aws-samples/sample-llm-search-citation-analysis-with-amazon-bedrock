import {
  existsSync, mkdirSync, readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterEach, describe, expect, it, vi,
} from 'vitest';

import setup from './cleanup-synth-output';

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return { ...fs, readdirSync: vi.fn(fs.readdirSync) };
});

/** More than a coarse kernel clock tick (4 ms at 250 Hz, 10 ms at 100 Hz). */
const FILE_CLOCK_LAG_MS = 50;

describe('cleanup-synth-output teardown', () => {
  afterEach(() => {
    vi.mocked(readdirSync).mockRestore();
  });

  it('removes a cdk.out folder created during the run', async () => {
    const teardown = setup();
    // File times come from the kernel's coarse clock, which can lag Date.now() by a few milliseconds on Linux:
    // create the folder once that clock is past the run's start, as a stack synthesized during a run is.
    await new Promise((resolve) => { setTimeout(resolve, FILE_CLOCK_LAG_MS); });
    const name = `cdk.out-cleanup-spec-${process.pid}-${Date.now()}`;
    const created = join(tmpdir(), name);
    mkdirSync(created);
    // Only this folder is listed, so a concurrent run's synth output is never touched.
    vi.mocked(readdirSync).mockReturnValueOnce([name] as never);

    teardown();

    expect(existsSync(created)).toBe(false);
  });

  it('skips a listed cdk.out folder another process removed before it was checked', () => {
    const teardown = setup();
    const removed = `cdk.out-cleanup-spec-removed-${process.pid}-${Date.now()}`;
    vi.mocked(readdirSync).mockReturnValueOnce([removed] as never);

    expect(() => teardown()).not.toThrow();
  });
});
