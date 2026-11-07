import {
  describe, expect, it
} from 'vitest';
import {
  NO_BRAND_SETTINGS, competitorDomainEntries, decodeBrandSettings
} from './brandSettings';

describe('decodeBrandSettings', () => {
  it('reads the first-party brand names of the tracked brands', () => {
    const settings = decodeBrandSettings({ tracked_brands: { first_party: ['Hotel Example', ' '] } });

    expect(settings.brandNames).toStrictEqual(['Hotel Example']);
  });

  it('reads the own domains in Settings order without duplicates', () => {
    const settings = decodeBrandSettings({ first_party_domains: ['example.com', 'example.org', 'example.com'] });

    expect(settings.ownedDomains).toStrictEqual(['example.com', 'example.org']);
  });

  it('lists one entry per competitor domain with the competitor name', () => {
    const settings = decodeBrandSettings({ competitor_domains: { Acme: ['acme.example.org', 'acme.example.net'] } });

    expect(settings.competitorDomains).toStrictEqual([
      {
        name: 'Acme',
        domain: 'acme.example.org',
      },
      {
        name: 'Acme',
        domain: 'acme.example.net',
      },
    ]);
  });

  it('answers empty settings for a payload that is not an object', () => {
    expect(decodeBrandSettings('nope')).toStrictEqual(NO_BRAND_SETTINGS);
  });
});

describe('competitorDomainEntries', () => {
  it('leaves out a competitor domain that is also the brand own', () => {
    expect(competitorDomainEntries({ Acme: ['example.com'] }, ['example.com'])).toStrictEqual([]);
  });

  it('keeps the first competitor of a domain listed twice', () => {
    const entries = competitorDomainEntries({
      Acme: ['shared.example.org'],
      Globex: ['shared.example.org'],
    }, []);

    expect(entries).toStrictEqual([{
      name: 'Acme',
      domain: 'shared.example.org',
    }]);
  });
});
