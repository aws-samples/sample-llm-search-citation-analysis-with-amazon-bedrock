import {
  describe, expect, it
} from 'vitest';
import { decodeProviders } from './providerDecoders';

const WIRE_DATAFORSEO = {
  id: 'dataforseo',
  name: 'DataForSEO',
  description: 'SEO data',
  docs_url: 'https://app.dataforseo.com/api-access',
  type: 'seo',
  credential_fields: ['login', 'password'],
  enabled: true,
  configured: true,
  masked_key: 'seo@example.com',
  last_updated: null,
};

const [DECODED_DATAFORSEO] = decodeProviders({ providers: [WIRE_DATAFORSEO] }) ?? [];

describe('decodeProviders', () => {
  it('keeps the credential fields of an SEO data provider', () => {
    expect([DECODED_DATAFORSEO.type, DECODED_DATAFORSEO.credential_fields]).toStrictEqual(['seo', ['login', 'password']]);
  });

  it('gives a provider without a model an empty model', () => {
    expect(DECODED_DATAFORSEO.model).toBe('');
  });

  it('keeps the provider a borrowed credential comes from', () => {
    const [row] = decodeProviders({
      providers: [{
        ...WIRE_DATAFORSEO,
        id: 'google_ai_overview',
        type: 'llm',
        credential_fields: undefined,
        credential_from: 'dataforseo',
      }],
    }) ?? [];

    expect(row.credential_from).toBe('dataforseo');
  });

  it.each([
    ['an unknown type', { type: 'crawler' }, 'type'],
    ['credential fields that are not strings', { credential_fields: ['login', 3] }, 'credential_fields'],
    ['an empty credential source', { credential_from: '' }, 'credential_from'],
  ])('drops %s', (_case, override, field) => {
    const [row] = decodeProviders({
      providers: [{
        ...WIRE_DATAFORSEO,
        ...override,
      }],
    }) ?? [];

    expect(Object.keys(row)).not.toContain(field);
  });

  it('drops a row without its enabled flag', () => {
    const rows = decodeProviders({
      providers: [{
        ...WIRE_DATAFORSEO,
        enabled: 'yes',
      }],
    });

    expect(rows).toStrictEqual([]);
  });

  it('returns null for a body without a provider list', () => {
    expect(decodeProviders({ error: 'Internal error' })).toBeNull();
  });
});
