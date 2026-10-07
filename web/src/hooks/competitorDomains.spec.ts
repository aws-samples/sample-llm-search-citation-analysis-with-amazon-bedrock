import {
  describe, it, expect
} from 'vitest';
import {
  MAX_DOMAINS_PER_COMPETITOR,
  competitorDomainChoices,
  domainsOfCompetitors,
  mergeSuggestedDomains,
  withCompetitorDomain,
  withoutCompetitorDomain,
} from './competitorDomains';

const TEN_DOMAINS = Array.from({ length: MAX_DOMAINS_PER_COMPETITOR }, (_unused, index) => `site${index}.borealis.example`);

describe('withCompetitorDomain', () => {
  it('appends the domain to the competitor', () => {
    expect(withCompetitorDomain({ 'Borealis Air': ['borealis-air.com'] }, 'Borealis Air', 'fly.borealis.example'))
      .toStrictEqual({ 'Borealis Air': ['borealis-air.com', 'fly.borealis.example'] });
  });

  it('starts a list for a competitor without domains', () => {
    expect(withCompetitorDomain({}, 'Cielo Wings', 'cielo-wings.example')).toStrictEqual({ 'Cielo Wings': ['cielo-wings.example'] });
  });

  it('keeps the domains unchanged when the domain is already listed', () => {
    const domains = { 'Borealis Air': ['borealis-air.com'] };

    expect(withCompetitorDomain(domains, 'Borealis Air', 'borealis-air.com')).toBe(domains);
  });

  it('keeps the domains unchanged when the competitor already has ten', () => {
    const domains = { 'Borealis Air': TEN_DOMAINS };

    expect(withCompetitorDomain(domains, 'Borealis Air', 'one-more.example')).toBe(domains);
  });
});

describe('withoutCompetitorDomain', () => {
  it('removes the domain from the competitor', () => {
    expect(withoutCompetitorDomain({ 'Borealis Air': ['borealis-air.com', 'fly.borealis.example'] }, 'Borealis Air', 'borealis-air.com'))
      .toStrictEqual({ 'Borealis Air': ['fly.borealis.example'] });
  });

  it('drops the competitor when its last domain is removed', () => {
    expect(withoutCompetitorDomain({
      'Borealis Air': ['borealis-air.com'],
      'Cielo Wings': ['cielo-wings.example'] 
    }, 'Borealis Air', 'borealis-air.com'))
      .toStrictEqual({ 'Cielo Wings': ['cielo-wings.example'] });
  });
});

describe('domainsOfCompetitors', () => {
  it('keeps only tracked competitors that have domains', () => {
    const domains = {
      'Borealis Air': ['borealis-air.com'],
      'Removed Rival': ['removed.example'],
      'Cielo Wings': [] 
    };

    expect(domainsOfCompetitors(domains, ['Borealis Air', 'Cielo Wings'])).toStrictEqual({ 'Borealis Air': ['borealis-air.com'] });
  });
});

describe('mergeSuggestedDomains', () => {
  it('adds new suggestions after the earlier ones without repeats', () => {
    const earlier = {
      'Borealis Air': ['borealis-air.com'],
      'Cielo Wings': ['cielo-wings.example'] 
    };

    expect(mergeSuggestedDomains(earlier, { 'Borealis Air': ['borealis-air.com', 'fly.borealis.example'] })).toStrictEqual({
      'Borealis Air': ['borealis-air.com', 'fly.borealis.example'],
      'Cielo Wings': ['cielo-wings.example'],
    });
  });
});

describe('competitorDomainChoices', () => {
  it('lists the saved domains first, then the suggestions not saved yet', () => {
    expect(competitorDomainChoices(['fly.borealis.example'], ['borealis-air.com', 'fly.borealis.example']))
      .toStrictEqual(['fly.borealis.example', 'borealis-air.com']);
  });
});
