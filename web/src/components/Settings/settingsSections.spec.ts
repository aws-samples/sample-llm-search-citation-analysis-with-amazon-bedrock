import {
  describe, it, expect
} from 'vitest';
import {
  isSettingsPath, sectionFromPath, settingsPath
} from './settingsSections';

describe('settingsPath', () => {
  it.each([
    ['keywords', '/settings/keywords'],
    ['brand-config', '/settings/brand'],
    ['query-prompts', '/settings/personas'],
    ['providers', '/settings/providers'],
    ['alerts', '/settings/alerts'],
    ['users', '/settings/users'],
  ] as const)('maps %s to %s', (section, path) => {
    expect(settingsPath(section)).toBe(path);
  });
});

describe('sectionFromPath', () => {
  it.each([
    ['/settings/brand', 'brand-config'],
    ['/settings/personas', 'query-prompts'],
    ['/settings/users', 'users'],
    ['/settings/providers/extra', 'providers'],
  ] as const)('opens %s as the %s section', (path, section) => {
    expect(sectionFromPath(path)).toBe(section);
  });

  it.each(['/settings', '/settings/', '/settings/unknown'])('falls back to keywords for %s', (path) => {
    expect(sectionFromPath(path)).toBe('keywords');
  });
});

describe('isSettingsPath', () => {
  it.each(['/settings', '/settings/users'])('accepts %s', (path) => {
    expect(isSettingsPath(path)).toBe(true);
  });

  it.each(['/settings-old', '/schedule', '/'])('rejects %s', (path) => {
    expect(isSettingsPath(path)).toBe(false);
  });
});
