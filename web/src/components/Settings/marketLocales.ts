/**
 * The country and language choices of the market form, named in English by
 * the browser (`Intl.DisplayNames`): the names are stored on the market and
 * go into the English instruction the AI engines receive, so they must not
 * follow the browser's own language. Only the codes are kept here.
 */

/** ISO 3166-1 alpha-2 codes of the countries the form offers. */
const COUNTRY_CODES = [
  'AD', 'AE', 'AF', 'AG', 'AL', 'AM', 'AO', 'AR', 'AT', 'AU', 'AZ', 'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ',
  'BN', 'BO', 'BR', 'BS', 'BT', 'BW', 'BY', 'BZ', 'CA', 'CD', 'CF', 'CG', 'CH', 'CI', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU',
  'CV', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE', 'EG', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FM', 'FR', 'GA',
  'GB', 'GD', 'GE', 'GH', 'GM', 'GN', 'GQ', 'GR', 'GT', 'GW', 'GY', 'HK', 'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IN',
  'IQ', 'IR', 'IS', 'IT', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KZ', 'LA', 'LB', 'LC',
  'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MR',
  'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA', 'NE', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NZ', 'OM', 'PA', 'PE', 'PG',
  'PH', 'PK', 'PL', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RO', 'RS', 'RU', 'RW', 'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SI',
  'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SY', 'SZ', 'TD', 'TG', 'TH', 'TJ', 'TL', 'TM', 'TN', 'TO', 'TR',
  'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'US', 'UY', 'UZ', 'VC', 'VE', 'VN', 'VU', 'WS', 'YE', 'ZA', 'ZM', 'ZW',
] as const;

/** ISO 639-1 codes of the languages the form offers. */
const LANGUAGE_CODES = [
  'af', 'am', 'ar', 'az', 'be', 'bg', 'bn', 'bs', 'ca', 'cs', 'cy', 'da', 'de', 'dz', 'el', 'en', 'es', 'et', 'eu', 'fa',
  'fi', 'fil', 'fr', 'ga', 'gl', 'gu', 'he', 'hi', 'hr', 'ht', 'hu', 'hy', 'id', 'is', 'it', 'ja', 'ka', 'kk', 'km', 'kn',
  'ko', 'ky', 'lb', 'lo', 'lt', 'lv', 'mg', 'mk', 'ml', 'mn', 'mr', 'ms', 'mt', 'my', 'nb', 'ne', 'nl', 'pa', 'pl', 'ps',
  'pt', 'ro', 'ru', 'rw', 'si', 'sk', 'sl', 'so', 'sq', 'sr', 'sv', 'sw', 'ta', 'te', 'tg', 'th', 'ti', 'tk', 'tr', 'uk',
  'ur', 'uz', 'vi', 'zh', 'zu',
] as const;

export interface LocaleOption {
  readonly code: string;
  readonly name: string;
}

function englishNames(type: 'region' | 'language'): Intl.DisplayNames {
  return new Intl.DisplayNames(['en'], {
    type,
    fallback: 'code',
  });
}

function options(codes: readonly string[], type: 'region' | 'language'): LocaleOption[] {
  const names = englishNames(type);
  return codes
    .map((code) => ({
      code,
      name: names.of(code) ?? code,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/** Every country the form offers, by English name. */
export function countryOptions(): LocaleOption[] {
  return options(COUNTRY_CODES, 'region');
}

/** Every language the form offers, by English name. */
export function languageOptions(): LocaleOption[] {
  return options(LANGUAGE_CODES, 'language');
}

/** The English name of a country or language code, or the code itself when the browser does not know it. */
export function localeName(code: string, type: 'region' | 'language'): string {
  return englishNames(type).of(code) ?? code;
}
