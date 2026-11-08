import {
  describe, expect, it
} from 'vitest';
import {
  effectiveTarget, mergeDomainPicks, settingsDomainPicks, submitLabel
} from './settingsDomains';
import { buildBrandSettings } from './settingsDomains-fixtures';
import type { DomainPick } from './settingsDomains';

const ACME_PICK: DomainPick = {
  domain: 'acme.example.org',
  role: 'competitor',
  competitor: 'Acme',
};

describe('settingsDomainPicks', () => {
  it('lists the own domains first, then each competitor domain with its competitor name', () => {
    expect(settingsDomainPicks(buildBrandSettings())).toStrictEqual([
      {
        domain: 'brand.example',
        role: 'owned',
        competitor: null,
      },
      {
        domain: 'acme.example.org',
        role: 'competitor',
        competitor: 'Acme',
      },
      {
        domain: 'globex.example',
        role: 'competitor',
        competitor: 'Globex',
      },
    ]);
  });

  it('returns no picks when Brand Tracking has no domains', () => {
    expect(settingsDomainPicks(buildBrandSettings({
      ownedDomains: [],
      competitorDomains: [],
    }))).toStrictEqual([]);
  });
});

describe('mergeDomainPicks', () => {
  it('keeps the first occurrence of a domain listed twice', () => {
    const merged = mergeDomainPicks([ACME_PICK], [{
      ...ACME_PICK,
      competitor: 'Acme Corp',
    }]);

    expect(merged).toStrictEqual([ACME_PICK]);
  });

  it('puts own domains of a later list before competitor domains of an earlier one', () => {
    const merged = mergeDomainPicks(
      [ACME_PICK],
      [{
        domain: 'brand.example',
        role: 'owned',
        competitor: null,
      }],
    );

    expect(merged.map((pick) => pick.domain)).toStrictEqual(['brand.example', 'acme.example.org']);
  });
});

describe('effectiveTarget', () => {
  it.each([
    ['', 'brand.example', 'brand.example'],
    ['   ', 'brand.example', 'brand.example'],
    [' other.example ', 'brand.example', 'other.example'],
    ['', null, ''],
  ])('turns input %j with own domain %j into target %j', (typed, ownDomain, expected) => {
    expect(effectiveTarget(typed, ownDomain)).toBe(expected);
  });
});

describe('submitLabel', () => {
  it.each([
    ['', 'brand.example', 'Analyze brand.example'],
    ['other.example', 'brand.example', 'Search'],
    ['', null, 'Search'],
  ])('labels the button for input %j and own domain %j as %j', (typed, ownDomain, expected) => {
    expect(submitLabel(typed, ownDomain, 'Search')).toBe(expected);
  });
});
