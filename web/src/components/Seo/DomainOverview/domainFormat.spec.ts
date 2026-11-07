import {
  describe, expect, it
} from 'vitest';
import { INTENT_TONES } from './domainFormat';

describe('INTENT_TONES', () => {
  it.each([
    ['informational', 'blue'],
    ['commercial', 'purple'],
    ['transactional', 'green'],
    ['navigational', 'indigo'],
    ['unknown', 'neutral'],
  ] as const)('gives %s intent the %s tone', (intent, tone) => {
    expect(INTENT_TONES[intent]).toBe(tone);
  });

  it('gives every intent a tone of its own', () => {
    const tones = Object.values(INTENT_TONES);

    expect(new Set(tones).size).toBe(tones.length);
  });
});
