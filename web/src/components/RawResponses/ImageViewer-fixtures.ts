import type { S3Item } from '../../types';
import { buildFile } from './FileViewer-fixtures';

/** A 50 KB screenshot in the screenshots folder; every field can be overridden. */
export function buildImageFile(overrides: Partial<S3Item> = {}): S3Item {
  return buildFile({
    name: 'screenshot.png',
    path: 'screenshots/screenshot.png',
    type: 'image',
    size: 51200,
    ...overrides,
  });
}
