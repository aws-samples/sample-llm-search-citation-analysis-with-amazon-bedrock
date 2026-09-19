import type { S3Item } from '../../types';

export function buildFile(overrides: Partial<S3Item> = {}): S3Item {
  return {
    name: 'screenshot.png',
    path: 'screenshots/screenshot.png',
    type: 'image',
    size: 51200,
    last_modified: '2024-01-15T10:30:00Z',
    ...overrides,
  };
}
