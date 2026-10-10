import {
  describe, expect, it
} from 'vitest';
import {
  countryOptions, languageOptions, localeName
} from './marketLocales';

describe('countryOptions', () => {
  it('names each country in English by its ISO code', () => {
    const options = countryOptions();

    expect(options).toContainEqual({
      code: 'CL',
      name: 'Chile',
    });
    expect(options).toContainEqual({
      code: 'US',
      name: 'United States',
    });
  });

  it('orders the countries by English name, not by code', () => {
    expect(countryOptions()[0]).toStrictEqual({
      code: 'AF',
      name: 'Afghanistan',
    });
  });

  it('offers each country once', () => {
    const codes = countryOptions().map((option) => option.code);

    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('languageOptions', () => {
  it('names each language in English by its ISO code', () => {
    const options = languageOptions();

    expect(options).toContainEqual({
      code: 'es',
      name: 'Spanish',
    });
    expect(options).toContainEqual({
      code: 'fil',
      name: 'Filipino',
    });
  });
});

describe('every option list', () => {
  it.each([
    ['countries', countryOptions],
    ['languages', languageOptions],
  ])('orders the %s by English name', (_description, options) => {
    const names = options().map((option) => option.name);

    expect(names).toStrictEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
  });
});

describe('localeName', () => {
  it.each([
    ['a country', 'BR', 'region', 'Brazil'],
    ['a language', 'pt', 'language', 'Portuguese'],
    ['a language with a region', 'es-CL', 'language', 'Spanish (Chile)'],
  ] as const)('names %s in English', (_description, code, type, name) => {
    expect(localeName(code, type)).toBe(name);
  });

  it.each([
    ['a user-assigned country code', 'QX', 'region'],
    ['an unknown language code', 'zz', 'language'],
  ] as const)('falls back to the code for %s', (_description, code, type) => {
    expect(localeName(code, type)).toBe(code);
  });
});
