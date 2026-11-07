import {
  describe, expect, it
} from 'vitest';
import {
  groupProviders, joinCredential, withBorrowedCredentials
} from './providerCredentials';
import {
  buildAiOverviewProvider, buildDataForSeoProvider, buildProviderConfig
} from './ProvidersConfig-fixtures';

const LOGIN_FIELDS = ['login', 'password'];

describe('joinCredential', () => {
  it('joins trimmed inputs with a colon', () => {
    expect(joinCredential(LOGIN_FIELDS, [' seo@example.com ', 'pa:ss'])).toStrictEqual({
      ok: true,
      apiKey: 'seo@example.com:pa:ss',
    });
  });

  it('refuses a login that holds a colon', () => {
    expect(joinCredential(LOGIN_FIELDS, ['seo:example', 'pass'])).toStrictEqual({
      ok: false,
      reason: 'Login cannot contain ":"',
    });
  });

  it('refuses an empty login', () => {
    expect(joinCredential(LOGIN_FIELDS, ['', 'pass'])).toStrictEqual({
      ok: false,
      reason: 'Login cannot be empty',
    });
  });
});

describe('withBorrowedCredentials', () => {
  it.each([
    ['configured when its source has a key', [buildAiOverviewProvider(), buildDataForSeoProvider({ configured: true })], true],
    ['unconfigured when its source has no key', [buildAiOverviewProvider({ configured: true }), buildDataForSeoProvider()], false],
    ['as sent when its source is not listed', [buildAiOverviewProvider({ configured: true })], true],
  ])('shows a borrowing provider %s', (_case, providers, configured) => {
    expect(withBorrowedCredentials(providers)[0].configured).toBe(configured);
  });
});

describe('groupProviders', () => {
  it('puts SEO data providers in their own group', () => {
    const groups = groupProviders([buildDataForSeoProvider(), buildProviderConfig(), buildAiOverviewProvider()]);

    expect([groups.engines.map((row) => row.id), groups.seo.map((row) => row.id)]).toStrictEqual([
      ['claude', 'google_ai_overview'],
      ['dataforseo'],
    ]);
  });
});
