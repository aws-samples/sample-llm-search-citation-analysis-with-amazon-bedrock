"""DataForSEO location and language codes for our markets.

The countries DataForSEO serves keyword data for (``LOCATION_OPTIONS``: 94 Labs countries plus 49 served only
by the Google Ads endpoints), the SERP language list, the countries that offer more than one language, and the
mapping from one of our markets (country + BCP 47 language, ``shared.markets.Market``) to the
``location_code`` / ``language_code`` pair every DataForSEO call takes.

A market DataForSEO does not serve raises ``UnsupportedMarketError`` instead of falling back to a default,
because an unsupported pair is a *charged* "Invalid Field" failure upstream and a silent fallback would store
data under the wrong market.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from shared.markets import GLOBAL_MARKET_ID, Market

DEFAULT_LOCATION_CODE = 2840
"""United States, the product-wide default and the global market's location."""


@dataclass(frozen=True)
class LocationOption:
    """One country DataForSEO serves."""

    code: int
    label: str
    short_label: str
    """ISO 3166-1 alpha-2, except the United Kingdom's display label ``UK`` (ISO ``GB``)."""
    language_code: str
    """The country's default language (the one with the largest keyword corpus)."""
    google_ads_only: bool = False
    """Set when DataForSEO Labs does not cover the country; keyword data then comes from Google Ads."""


@dataclass(frozen=True)
class MarketCodes:
    """DataForSEO location and language for one market."""

    location_code: int
    language_code: str
    keyword_data: Literal['labs', 'google_ads']


class UnsupportedMarketError(ValueError):
    """The market's country or language is not served by DataForSEO."""


ISO_COUNTRY_OVERRIDES: dict[str, str] = {'UK': 'GB'}
"""``short_label`` values that are not ISO 3166-1 alpha-2."""

LOCATION_OPTIONS: tuple[LocationOption, ...] = (
    LocationOption(2008, 'Albania', 'AL', 'sq'),
    LocationOption(2012, 'Algeria', 'DZ', 'fr'),
    LocationOption(2020, 'Andorra', 'AD', 'ca', True),
    LocationOption(2024, 'Angola', 'AO', 'pt'),
    LocationOption(2032, 'Argentina', 'AR', 'es'),
    LocationOption(2051, 'Armenia', 'AM', 'hy'),
    LocationOption(2036, 'Australia', 'AU', 'en'),
    LocationOption(2040, 'Austria', 'AT', 'de'),
    LocationOption(2031, 'Azerbaijan', 'AZ', 'az'),
    LocationOption(2044, 'Bahamas', 'BS', 'en', True),
    LocationOption(2048, 'Bahrain', 'BH', 'ar'),
    LocationOption(2050, 'Bangladesh', 'BD', 'bn'),
    LocationOption(2052, 'Barbados', 'BB', 'en', True),
    LocationOption(2056, 'Belgium', 'BE', 'nl'),
    LocationOption(2084, 'Belize', 'BZ', 'en', True),
    LocationOption(2068, 'Bolivia', 'BO', 'es'),
    LocationOption(2070, 'Bosnia and Herzegovina', 'BA', 'bs'),
    LocationOption(2072, 'Botswana', 'BW', 'en', True),
    LocationOption(2076, 'Brazil', 'BR', 'pt'),
    LocationOption(2096, 'Brunei', 'BN', 'ms', True),
    LocationOption(2100, 'Bulgaria', 'BG', 'bg'),
    LocationOption(2854, 'Burkina Faso', 'BF', 'fr'),
    LocationOption(2116, 'Cambodia', 'KH', 'en'),
    LocationOption(2120, 'Cameroon', 'CM', 'fr'),
    LocationOption(2124, 'Canada', 'CA', 'en'),
    LocationOption(2152, 'Chile', 'CL', 'es'),
    LocationOption(2170, 'Colombia', 'CO', 'es'),
    LocationOption(2188, 'Costa Rica', 'CR', 'es'),
    LocationOption(2384, "Cote d'Ivoire", 'CI', 'fr'),
    LocationOption(2191, 'Croatia', 'HR', 'hr'),
    LocationOption(2196, 'Cyprus', 'CY', 'el'),
    LocationOption(2203, 'Czechia', 'CZ', 'cs'),
    LocationOption(2208, 'Denmark', 'DK', 'da'),
    LocationOption(2214, 'Dominican Republic', 'DO', 'es', True),
    LocationOption(2218, 'Ecuador', 'EC', 'es'),
    LocationOption(2818, 'Egypt', 'EG', 'ar'),
    LocationOption(2222, 'El Salvador', 'SV', 'es'),
    LocationOption(2233, 'Estonia', 'EE', 'et'),
    LocationOption(2231, 'Ethiopia', 'ET', 'en', True),
    LocationOption(2242, 'Fiji', 'FJ', 'en', True),
    LocationOption(2246, 'Finland', 'FI', 'fi'),
    LocationOption(2250, 'France', 'FR', 'fr'),
    LocationOption(2268, 'Georgia', 'GE', 'en', True),
    LocationOption(2276, 'Germany', 'DE', 'de'),
    LocationOption(2288, 'Ghana', 'GH', 'en'),
    LocationOption(2300, 'Greece', 'GR', 'el'),
    LocationOption(2320, 'Guatemala', 'GT', 'es'),
    LocationOption(2831, 'Guernsey', 'GG', 'en', True),
    LocationOption(2328, 'Guyana', 'GY', 'en', True),
    LocationOption(2332, 'Haiti', 'HT', 'fr', True),
    LocationOption(2340, 'Honduras', 'HN', 'es', True),
    LocationOption(2344, 'Hong Kong', 'HK', 'zh-TW'),
    LocationOption(2348, 'Hungary', 'HU', 'hu'),
    LocationOption(2352, 'Iceland', 'IS', 'is', True),
    LocationOption(2356, 'India', 'IN', 'en'),
    LocationOption(2360, 'Indonesia', 'ID', 'id'),
    LocationOption(2368, 'Iraq', 'IQ', 'ar', True),
    LocationOption(2372, 'Ireland', 'IE', 'en'),
    LocationOption(2833, 'Isle of Man', 'IM', 'en', True),
    LocationOption(2376, 'Israel', 'IL', 'he'),
    LocationOption(2380, 'Italy', 'IT', 'it'),
    LocationOption(2388, 'Jamaica', 'JM', 'en', True),
    LocationOption(2392, 'Japan', 'JP', 'ja'),
    LocationOption(2832, 'Jersey', 'JE', 'en', True),
    LocationOption(2400, 'Jordan', 'JO', 'ar'),
    LocationOption(2398, 'Kazakhstan', 'KZ', 'ru'),
    LocationOption(2404, 'Kenya', 'KE', 'en'),
    LocationOption(2414, 'Kuwait', 'KW', 'ar', True),
    LocationOption(2417, 'Kyrgyzstan', 'KG', 'ru', True),
    LocationOption(2418, 'Laos', 'LA', 'en', True),
    LocationOption(2428, 'Latvia', 'LV', 'lv'),
    LocationOption(2422, 'Lebanon', 'LB', 'ar', True),
    LocationOption(2438, 'Liechtenstein', 'LI', 'de', True),
    LocationOption(2440, 'Lithuania', 'LT', 'lt'),
    LocationOption(2442, 'Luxembourg', 'LU', 'fr', True),
    LocationOption(2450, 'Madagascar', 'MG', 'fr', True),
    LocationOption(2454, 'Malawi', 'MW', 'en', True),
    LocationOption(2458, 'Malaysia', 'MY', 'en'),
    LocationOption(2462, 'Maldives', 'MV', 'en', True),
    LocationOption(2470, 'Malta', 'MT', 'en'),
    LocationOption(2480, 'Mauritius', 'MU', 'en', True),
    LocationOption(2484, 'Mexico', 'MX', 'es'),
    LocationOption(2498, 'Moldova', 'MD', 'ro'),
    LocationOption(2492, 'Monaco', 'MC', 'fr'),
    LocationOption(2496, 'Mongolia', 'MN', 'en', True),
    LocationOption(2499, 'Montenegro', 'ME', 'sr', True),
    LocationOption(2504, 'Morocco', 'MA', 'ar'),
    LocationOption(2508, 'Mozambique', 'MZ', 'pt', True),
    LocationOption(2104, 'Myanmar (Burma)', 'MM', 'en'),
    LocationOption(2516, 'Namibia', 'NA', 'en', True),
    LocationOption(2524, 'Nepal', 'NP', 'en', True),
    LocationOption(2528, 'Netherlands', 'NL', 'nl'),
    LocationOption(2554, 'New Zealand', 'NZ', 'en'),
    LocationOption(2558, 'Nicaragua', 'NI', 'es'),
    LocationOption(2566, 'Nigeria', 'NG', 'en'),
    LocationOption(2807, 'North Macedonia', 'MK', 'mk'),
    LocationOption(2578, 'Norway', 'NO', 'nb'),
    LocationOption(2512, 'Oman', 'OM', 'ar', True),
    LocationOption(2586, 'Pakistan', 'PK', 'en'),
    LocationOption(2275, 'Palestine', 'PS', 'ar', True),
    LocationOption(2591, 'Panama', 'PA', 'es'),
    LocationOption(2598, 'Papua New Guinea', 'PG', 'en', True),
    LocationOption(2600, 'Paraguay', 'PY', 'es'),
    LocationOption(2604, 'Peru', 'PE', 'es'),
    LocationOption(2608, 'Philippines', 'PH', 'en'),
    LocationOption(2616, 'Poland', 'PL', 'pl'),
    LocationOption(2620, 'Portugal', 'PT', 'pt'),
    LocationOption(2634, 'Qatar', 'QA', 'ar', True),
    LocationOption(2642, 'Romania', 'RO', 'ro'),
    LocationOption(2646, 'Rwanda', 'RW', 'en', True),
    LocationOption(2674, 'San Marino', 'SM', 'it', True),
    LocationOption(2682, 'Saudi Arabia', 'SA', 'ar'),
    LocationOption(2686, 'Senegal', 'SN', 'fr'),
    LocationOption(2688, 'Serbia', 'RS', 'sr'),
    LocationOption(2702, 'Singapore', 'SG', 'en'),
    LocationOption(2703, 'Slovakia', 'SK', 'sk'),
    LocationOption(2705, 'Slovenia', 'SI', 'sl'),
    LocationOption(2710, 'South Africa', 'ZA', 'en'),
    LocationOption(2410, 'South Korea', 'KR', 'ko'),
    LocationOption(2724, 'Spain', 'ES', 'es'),
    LocationOption(2144, 'Sri Lanka', 'LK', 'en'),
    LocationOption(2740, 'Suriname', 'SR', 'nl', True),
    LocationOption(2752, 'Sweden', 'SE', 'sv'),
    LocationOption(2756, 'Switzerland', 'CH', 'de'),
    LocationOption(2158, 'Taiwan', 'TW', 'zh-TW'),
    LocationOption(2762, 'Tajikistan', 'TJ', 'ru', True),
    LocationOption(2834, 'Tanzania', 'TZ', 'en', True),
    LocationOption(2764, 'Thailand', 'TH', 'th'),
    LocationOption(2780, 'Trinidad and Tobago', 'TT', 'en', True),
    LocationOption(2788, 'Tunisia', 'TN', 'ar'),
    LocationOption(2792, 'Turkiye', 'TR', 'tr'),
    LocationOption(2795, 'Turkmenistan', 'TM', 'ru', True),
    LocationOption(2800, 'Uganda', 'UG', 'en', True),
    LocationOption(2804, 'Ukraine', 'UA', 'uk'),
    LocationOption(2784, 'United Arab Emirates', 'AE', 'en'),
    LocationOption(2826, 'United Kingdom', 'UK', 'en'),
    LocationOption(2840, 'United States', 'US', 'en'),
    LocationOption(2858, 'Uruguay', 'UY', 'es'),
    LocationOption(2860, 'Uzbekistan', 'UZ', 'ru', True),
    LocationOption(2862, 'Venezuela', 'VE', 'es'),
    LocationOption(2704, 'Vietnam', 'VN', 'vi'),
    LocationOption(2894, 'Zambia', 'ZM', 'en', True),
    LocationOption(2716, 'Zimbabwe', 'ZW', 'en', True),
)

SERP_LANGUAGE_OPTIONS: tuple[tuple[str, str], ...] = (
    ('af', 'Afrikaans'), ('ak', 'Akan'), ('sq', 'Albanian'), ('am', 'Amharic'), ('ar', 'Arabic'),
    ('hy', 'Armenian'), ('az', 'Azerbaijani'), ('ban', 'Balinese'), ('eu', 'Basque'), ('be', 'Belarusian'),
    ('bn', 'Bengali'), ('bs', 'Bosnian'), ('bg', 'Bulgarian'), ('my', 'Burmese'), ('ca', 'Catalan'),
    ('ceb', 'Cebuano'), ('ny', 'Chichewa'), ('zh-CN', 'Chinese (Simplified)'), ('zh-TW', 'Chinese (Traditional)'),
    ('hr', 'Croatian'), ('cs', 'Czech'), ('da', 'Danish'), ('nl', 'Dutch'), ('en', 'English'), ('et', 'Estonian'),
    ('ee', 'Ewe'), ('fo', 'Faroese'), ('fa', 'Farsi'), ('fil', 'Filipino'), ('fi', 'Finnish'), ('fr', 'French'),
    ('fy', 'Frisian'), ('gaa', 'Ga'), ('gl', 'Galician'), ('lg', 'Ganda'), ('ka', 'Georgian'), ('de', 'German'),
    ('el', 'Greek'), ('gu', 'Gujarati'), ('ht', 'Haitian'), ('ha', 'Hausa'), ('he', 'Hebrew'), ('hi', 'Hindi'),
    ('hu', 'Hungarian'), ('is', 'Icelandic'), ('bem', 'IciBemba'), ('ig', 'Igbo'), ('id', 'Indonesian'),
    ('ga', 'Irish'), ('it', 'Italian'), ('ja', 'Japanese'), ('kn', 'Kannada'), ('kk', 'Kazakh'), ('km', 'Khmer'),
    ('rw', 'Kinyarwanda'), ('rn', 'Kirundi'), ('kg', 'Kongo'), ('ko', 'Korean'), ('mfe', 'Kreol morisien'),
    ('crs', 'Kreol Seselwa'), ('kri', 'Krio'), ('ckb', 'Kurdish'), ('ky', 'Kyrgyz'), ('lo', 'Lao'),
    ('lv', 'Latvian'), ('ln', 'Lingala'), ('lt', 'Lithuanian'), ('ach', 'Luo'), ('mk', 'Macedonian'),
    ('mg', 'Malagasy'), ('ms', 'Malay'), ('ml', 'Malayalam'), ('mt', 'Maltese'), ('mi', 'Maori'), ('mr', 'Marathi'),
    ('mn', 'Mongolian'), ('ne', 'Nepali'), ('nso', 'Northern Sotho'), ('nb', 'Norwegian (Bokmål)'),
    ('nyn', 'Nyankole'), ('om', 'Oromo'), ('ps', 'Pashto'), ('pcm', 'Pidgin'), ('pl', 'Polish'),
    ('pt', 'Portuguese'), ('pt-BR', 'Portuguese (Brazil)'), ('pt-PT', 'Portuguese (Portugal)'), ('pa', 'Punjabi'),
    ('qu', 'Quechua'), ('ro', 'Romanian'), ('rm', 'Romansh'), ('ru', 'Russian'), ('sr', 'Serbian'),
    ('sr-Latn', 'Serbian (Latin)'), ('sr-ME', 'Serbian (Montenegro)'), ('st', 'Sesotho'), ('sn', 'Shona'),
    ('loz', 'Silozi'), ('sd', 'Sindhi'), ('si', 'Sinhalese'), ('sk', 'Slovak'), ('sl', 'Slovenian'),
    ('so', 'Somali'), ('es', 'Spanish'), ('es-419', 'Spanish (Latin America)'), ('sw', 'Swahili'),
    ('sv', 'Swedish'), ('tl', 'Tagalog'), ('tg', 'Tajik'), ('ta', 'Tamil'), ('te', 'Telugu'), ('th', 'Thai'),
    ('ti', 'Tigrinya'), ('to', 'Tonga (Tonga Islands)'), ('lua', 'Tshiluba'), ('tn', 'Tswana'), ('tum', 'Tumbuka'),
    ('tr', 'Turkish'), ('tk', 'Turkmen'), ('uk', 'Ukrainian'), ('ur', 'Urdu'), ('uz', 'Uzbek'),
    ('vi', 'Vietnamese'), ('cy', 'Welsh'), ('wo', 'Wolof'), ('xh', 'Xhosa'), ('yo', 'Yoruba'), ('zu', 'Zulu'),
)
"""Every ``language_code`` the DataForSEO SERP API accepts, with its display name (deprecated ``iw`` and
redundant ``no`` dropped: Norway uses ``nb``)."""

MULTI_LANGUAGE_LOCATIONS: dict[int, tuple[str, ...]] = {
    2012: ('ar', 'fr'),  # Algeria
    2056: ('de', 'fr', 'nl'),  # Belgium
    2124: ('en', 'fr'),  # Canada
    2196: ('el', 'en'),  # Cyprus
    2300: ('el', 'en'),  # Greece
    2344: ('en', 'zh-TW'),  # Hong Kong
    2356: ('en', 'hi'),  # India
    2360: ('en', 'id'),  # Indonesia
    2376: ('ar', 'he'),  # Israel
    2458: ('en', 'ms'),  # Malaysia
    2504: ('ar', 'fr'),  # Morocco
    2586: ('en', 'ur'),  # Pakistan
    2608: ('en', 'tl'),  # Philippines
    2702: ('en', 'zh-CN'),  # Singapore
    2756: ('de', 'fr', 'it'),  # Switzerland
    2784: ('ar', 'en'),  # United Arab Emirates
    2804: ('ru', 'uk'),  # Ukraine
    2818: ('ar', 'en'),  # Egypt
    2840: ('en', 'es'),  # United States
    2704: ('en', 'vi'),  # Vietnam
}
"""Countries where DataForSEO offers more than one language (each list includes the default); every other
country offers only its default language."""

GLOBAL_MARKET_CODES = MarketCodes(DEFAULT_LOCATION_CODE, 'en', 'labs')
"""The global market (no ``market_id``): US / English, like every other provider's default."""


def iso_country_code(option: LocationOption) -> str:
    """Lower-case ISO 3166-1 alpha-2 of ``option`` (``gb`` for the ``UK`` label)."""
    return ISO_COUNTRY_OVERRIDES.get(option.short_label, option.short_label).lower()


_BY_CODE: dict[int, LocationOption] = {option.code: option for option in LOCATION_OPTIONS}
_BY_ISO: dict[str, LocationOption] = {iso_country_code(option).upper(): option for option in LOCATION_OPTIONS}
_SERP_LANGUAGES: dict[str, str] = {code.lower(): code for code, _label in SERP_LANGUAGE_OPTIONS}


def language_options(location_code: int) -> tuple[str, ...]:
    """The language codes DataForSEO's keyword-data APIs serve for ``location_code`` (default first if single)."""
    option = _BY_CODE.get(location_code)
    default = option.language_code if option else 'en'
    return MULTI_LANGUAGE_LOCATIONS.get(location_code, (default,))


def keyword_data_language(codes: MarketCodes) -> str:
    """The language to send to Labs / Google Ads for ``codes``.

    The SERP API serves any language, but the keyword-data APIs only
    serve a country's own languages and reject others as a charged "Invalid Field: 'language_code'" failure,
    so a SERP-only code (e.g. ``pt-BR``) falls back to the country's default language.
    """
    if codes.language_code in language_options(codes.location_code):
        return codes.language_code
    option = _BY_CODE.get(codes.location_code)
    return option.language_code if option else 'en'


def _resolve_language(language: str, option: LocationOption) -> str:
    """The SERP ``language_code`` for a market's BCP 47 ``language`` in ``option``'s country.

    A code the SERP list has exactly wins when the country serves it or its primary subtag (so ``pt-BR`` in
    Brazil stays ``pt-BR``); otherwise the primary subtag when the country serves it (``de-DE`` → ``de``).
    """
    served = language_options(option.code)
    primary = language.split('-', 1)[0].lower()
    exact = _SERP_LANGUAGES.get(language.lower())
    if exact is not None and (exact in served or primary in served):
        return exact
    if primary in served:
        return primary
    raise UnsupportedMarketError(
        f"DataForSEO does not serve language {language!r} for {option.label}; served: {', '.join(served)}"
    )


def market_codes(market: Market | None) -> MarketCodes:
    """DataForSEO location and language for ``market``; ``None`` or the global market → US / English.

    Raises:
        UnsupportedMarketError: The country is not in ``LOCATION_OPTIONS`` or its language is not served.
    """
    if market is None or market.market_id == GLOBAL_MARKET_ID:
        return GLOBAL_MARKET_CODES
    option = _BY_ISO.get(market.country.upper())
    if option is None:
        raise UnsupportedMarketError(f'DataForSEO does not serve keyword data for country {market.country!r}')
    return MarketCodes(
        location_code=option.code,
        language_code=_resolve_language(market.language, option),
        keyword_data='google_ads' if option.google_ads_only else 'labs',
    )


__all__ = [
    'DEFAULT_LOCATION_CODE',
    'GLOBAL_MARKET_CODES',
    'ISO_COUNTRY_OVERRIDES',
    'LOCATION_OPTIONS',
    'MULTI_LANGUAGE_LOCATIONS',
    'SERP_LANGUAGE_OPTIONS',
    'LocationOption',
    'MarketCodes',
    'UnsupportedMarketError',
    'iso_country_code',
    'keyword_data_language',
    'language_options',
    'market_codes',
]
