/**
 * Replacement for `infrastructure/config` in SEO API client specs. Each spec
 * pins its own SEO API origin, so the URLs it asserts on are its own:
 *
 * ```ts
 * vi.mock('../infrastructure/config', async () => (await import('../test/seoConfigMock'))
 *   .buildSeoConfigMock('https://seo.example.com/api'));
 * ```
 *
 * The main API origin is the one `./infrastructureMock` pins for the barrel.
 */
import { API_BASE_URL } from './infrastructureMock';

export function buildSeoConfigMock(seoApiBaseUrl: string) {
  return {
    SEO_API_BASE_URL: seoApiBaseUrl,
    API_BASE_URL,
  };
}
