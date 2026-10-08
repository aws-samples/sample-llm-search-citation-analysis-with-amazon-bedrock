import {
  readdirSync, rmSync, statSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Vitest global setup for the CDK specs. Every `new cdk.App()` without an
 * `outdir` synthesizes into a fresh `cdk.out*` folder under the OS temp
 * directory, staged assets (the Lambda layers) included, and CDK never
 * removes it: about 340 MB per synthesized stack, which filled a 460 GB disk
 * after a few hundred test runs. The teardown deletes the folders this run
 * created and leaves older ones (another run's, still in use) alone.
 */
export default function setup(): () => void {
  const startedAt = Date.now();
  return () => {
    const root = tmpdir();
    for (const name of readdirSync(root)) {
      if (!name.startsWith('cdk.out')) continue;
      const path = join(root, name);
      if (statSync(path).birthtimeMs >= startedAt) {
        rmSync(path, {
          recursive: true,
          force: true,
        });
      }
    }
  };
}
