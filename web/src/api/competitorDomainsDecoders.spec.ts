import {
  describe, it, expect
} from 'vitest';
import {
  decodeCompetitorDomains, decodeSuggestedDomains
} from './competitorDomainsDecoders';

describe('decodeCompetitorDomains', () => {
  it('keeps each competitor whose domains are a list of strings', () => {
    expect(decodeCompetitorDomains({ 'Borealis Air': ['borealis-air.com'] })).toStrictEqual({ 'Borealis Air': ['borealis-air.com'] });
  });

  it('drops a competitor whose domains are not a list of strings', () => {
    expect(decodeCompetitorDomains({
      'Borealis Air': 'borealis-air.com',
      'Cielo Wings': [7],
      'Nimbus Jet': ['nimbus.example'],
    })).toStrictEqual({ 'Nimbus Jet': ['nimbus.example'] });
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['a list', ['borealis-air.com']],
  ])('returns an empty map when the stored value is %s', (_label, value) => {
    expect(decodeCompetitorDomains(value)).toStrictEqual({});
  });
});

describe('decodeSuggestedDomains', () => {
  it('maps each named competitor detail to its suggested domains', () => {
    const details = [
      {
        name: 'Nimbus Jet',
        reason: 'same routes',
        domains: ['nimbus-jet.example', 'book.nimbus.example'] 
      },
      {
        name: 'Polar Express Air',
        domains: ['polar-express.example'] 
      },
    ];

    expect(decodeSuggestedDomains(details)).toStrictEqual({
      'Nimbus Jet': ['nimbus-jet.example', 'book.nimbus.example'],
      'Polar Express Air': ['polar-express.example'],
    });
  });

  it('skips details without a name, without domains, or with an empty domain list', () => {
    const details = ['Borealis Air', { domains: ['nameless.example'] }, { name: 'Cielo Wings' }, {
      name: 'Nimbus Jet',
      domains: [] 
    }];

    expect(decodeSuggestedDomains(details)).toStrictEqual({});
  });

  it('returns an empty map when the answer has no detail list', () => {
    expect(decodeSuggestedDomains(undefined)).toStrictEqual({});
  });
});
