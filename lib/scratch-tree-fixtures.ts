import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * A new temporary directory holding `files` (relative path → text; parent
 * directories are created). Returns the directory; remove it with
 * `removeScratchTree` once the files have been used.
 */
export function writeScratchTree(prefix: string, files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  Object.entries(files).forEach(([name, text]) => {
    const file = join(dir, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  });
  return dir;
}

export function removeScratchTree(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
