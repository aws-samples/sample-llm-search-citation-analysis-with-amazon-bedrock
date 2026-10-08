import {
  describe, expect, it
} from 'vitest';
import {
  emptyMarketFormValues, marketFormValues, marketFromForm
} from './marketFormModel';
import { buildMarketFormValues } from './marketFormModel-fixtures';
import {
  BRAZIL, buildMarket, CHILE, SANTIAGO
} from '../Markets/markets-fixtures';

describe('marketFromForm', () => {
  it('builds the market of a complete form, naming it "Country (Language)" by default', () => {
    expect(marketFromForm(buildMarketFormValues(), [])).toStrictEqual({
      market: CHILE,
      error: null,
    });
  });

  it('keeps optional fields, upper-cases codes and collapses whitespace', () => {
    const result = marketFromForm(buildMarketFormValues({
      name: '  Chile   Santiago ',
      country: 'cl',
      currency: 'clp',
      city: ' Santiago ',
      region: 'RM',
      lat: '-33.4500001',
      lng: '-70.66',
      competitors: 'Sky Airline\n\n  JetSMART  \nsky airline',
      first_party_aliases: 'Altiplano Chile',
    }), []);

    expect(result.market).toStrictEqual({
      ...SANTIAGO,
      name: 'Chile Santiago',
    });
  });

  it.each([
    ['an upper-case id', { market_id: 'CL' }, 'market_id must be 2-32 lower-case letters, digits or dashes'],
    ['a one-character id', { market_id: 'c' }, 'market_id must be 2-32 lower-case letters, digits or dashes'],
    ['an id starting with a dash', { market_id: '-cl' }, 'market_id must be 2-32 lower-case letters, digits or dashes'],
    ['a 33-character id', { market_id: `c${'l'.repeat(32)}` }, 'market_id must be 2-32 lower-case letters, digits or dashes'],
    ['the reserved id', { market_id: 'global' }, "market_id 'global' is reserved"],
    ['a three-letter country', { country: 'CHL' }, 'country is not valid'],
    ['no country', { country: '' }, 'country is required'],
    ['a blank country name', { country_name: '   ' }, 'country_name is required'],
    ['an underscore language tag', { language: 'es_CL' }, 'language is not valid'],
    ['an upper-case primary language', { language: 'ES-CL' }, 'language is not valid'],
    ['no language name', { language_name: '' }, 'language_name is required'],
    ['a two-letter currency', { currency: 'CL' }, 'currency is not valid'],
    ['an unknown time zone', { timezone: 'Mars/Olympus' }, 'timezone must be an IANA time zone such as America/Santiago'],
    ['no time zone', { timezone: '' }, 'timezone is required'],
    ['an 81-character name', { name: 'n'.repeat(81) }, 'name must be at most 80 characters'],
    ['a 61-character country name', { country_name: 'c'.repeat(61) }, 'country_name must be at most 60 characters'],
    ['a control character in the city', { city: 'Santi\u200bago' }, 'city must not contain control characters'],
    ['a latitude beyond 90', {
      lat: '91',
      lng: '0' 
    }, 'lat must be between -90 and 90'],
    ['a longitude beyond -180', {
      lat: '0',
      lng: '-180.5' 
    }, 'lng must be between -180 and 180'],
    ['a text latitude', {
      lat: 'north',
      lng: '0' 
    }, 'lat must be a number'],
    ['a latitude without longitude', { lat: '10' }, 'lat and lng must be given together'],
    ['a 101-character competitor', { competitors: 'c'.repeat(101) }, 'competitors entries must be non-empty names of at most 100 characters'],
    ['51 aliases', { first_party_aliases: Array.from({ length: 51 }, (_value, index) => `Alias ${index}`).join('\n') }, 'first_party_aliases must be a list of at most 50 names'],
  ] as const)('refuses %s with the server message', (_description, overrides, message) => {
    expect(marketFromForm(buildMarketFormValues(overrides), [])).toStrictEqual({
      market: null,
      error: message,
    });
  });

  it('reports the first problem in the server order', () => {
    const result = marketFromForm(buildMarketFormValues({
      currency: 'x',
      country: 'x',
    }), []);

    expect(result.error).toBe('country is not valid');
  });

  it('refuses an id another market already uses', () => {
    expect(marketFromForm(buildMarketFormValues(), [BRAZIL, CHILE]).error).toBe("market_id 'cl-es' is used twice");
  });

  it('accepts a latitude and longitude of 0', () => {
    expect(marketFromForm(buildMarketFormValues({
      lat: '0',
      lng: '0',
    }), []).market).toStrictEqual(buildMarket({
      lat: 0,
      lng: 0,
    }));
  });

  it('accepts a three-letter primary language with subtags', () => {
    expect(marketFromForm(buildMarketFormValues({ language: 'gsw-Latn-CH' }), []).market?.language).toBe('gsw-Latn-CH');
  });
});

describe('marketFormValues', () => {
  it('round-trips a market with every optional field through the form', () => {
    expect(marketFromForm(marketFormValues(SANTIAGO), []).market).toStrictEqual(SANTIAGO);
  });

  it('leaves the optional fields blank for a market without them', () => {
    expect(marketFormValues(CHILE)).toStrictEqual(buildMarketFormValues({ name: 'Chile (Spanish)' }));
  });

  it('starts a new market with every field blank', () => {
    expect(Object.values(emptyMarketFormValues()).every((value) => value === '')).toBe(true);
  });
});
