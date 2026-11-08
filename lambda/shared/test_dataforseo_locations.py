"""Market → DataForSEO location and language codes."""

from __future__ import annotations

from dataclasses import replace

import pytest

from shared.dataforseo_locations import (
    GLOBAL_MARKET_CODES,
    LOCATION_OPTIONS,
    MULTI_LANGUAGE_LOCATIONS,
    SERP_LANGUAGE_OPTIONS,
    MarketCodes,
    UnsupportedMarketError,
    iso_country_code,
    keyword_data_language,
    language_options,
    market_codes,
)
from shared.markets import Market

EXAMPLE_MARKET = Market(
    market_id='de', name='Germany', country='DE', country_name='Germany', language='de-DE',
    language_name='German', currency='EUR', timezone='Europe/Berlin',
)
SERP_CODES = {code for code, _label in SERP_LANGUAGE_OPTIONS}


# --- the table ---------------------------------------------------------------------------------------------


def test_lists_143_countries_when_table_is_loaded():
    assert len(LOCATION_OPTIONS) == 143


def test_marks_49_countries_google_ads_only_when_table_is_loaded():
    assert sum(option.google_ads_only for option in LOCATION_OPTIONS) == 49


def test_keeps_location_codes_unique_when_table_is_loaded():
    codes = [option.code for option in LOCATION_OPTIONS]
    assert len(set(codes)) == len(codes)


def test_keeps_options_sorted_by_label_when_table_is_loaded():
    labels = [option.label for option in LOCATION_OPTIONS]
    assert labels == sorted(labels)


def test_lists_every_default_language_in_serp_languages_when_table_is_loaded():
    assert {option.language_code for option in LOCATION_OPTIONS} - SERP_CODES == set()


def test_lists_every_multi_language_code_in_serp_languages_when_table_is_loaded():
    codes = {code for languages in MULTI_LANGUAGE_LOCATIONS.values() for code in languages}
    assert codes - SERP_CODES == set()


def test_drops_deprecated_hebrew_and_norwegian_aliases_when_serp_languages_are_loaded():
    assert {'iw', 'no'} & SERP_CODES == set()


def test_maps_uk_display_label_to_iso_gb_when_iso_code_is_read():
    united_kingdom = next(option for option in LOCATION_OPTIONS if option.code == 2826)
    assert (united_kingdom.short_label, iso_country_code(united_kingdom)) == ('UK', 'gb')


def test_offers_only_the_default_language_when_country_is_single_language():
    assert language_options(2276) == ('de',)


def test_offers_english_and_spanish_when_country_is_united_states():
    assert language_options(2840) == ('en', 'es')


# --- market_codes ------------------------------------------------------------------------------------------


def test_returns_us_english_labs_when_market_is_none():
    assert market_codes(None) == MarketCodes(2840, 'en', 'labs')


def test_returns_us_english_labs_when_market_is_global():
    assert market_codes(replace(EXAMPLE_MARKET, market_id='global')) == GLOBAL_MARKET_CODES


def test_returns_country_code_and_primary_language_when_market_language_has_region():
    assert market_codes(EXAMPLE_MARKET) == MarketCodes(2276, 'de', 'labs')


def test_returns_location_2826_when_market_country_is_gb():
    market = replace(EXAMPLE_MARKET, country='GB', language='en-GB')
    assert market_codes(market) == MarketCodes(2826, 'en', 'labs')


def test_keeps_regioned_serp_language_when_list_has_it_exactly():
    market = replace(EXAMPLE_MARKET, country='BR', language='pt-BR')
    assert market_codes(market).language_code == 'pt-BR'


def test_matches_regioned_language_case_insensitively_when_market_uses_lower_case():
    market = replace(EXAMPLE_MARKET, country='TW', language='zh-tw')
    assert market_codes(market).language_code == 'zh-TW'


def test_returns_served_second_language_when_country_offers_several():
    market = replace(EXAMPLE_MARKET, country='CA', language='fr-CA')
    assert market_codes(market).language_code == 'fr'


def test_routes_keyword_data_to_google_ads_when_country_is_ads_only():
    market = replace(EXAMPLE_MARKET, country='IS', language='is-IS')
    assert market_codes(market) == MarketCodes(2352, 'is', 'google_ads')


def test_raises_unsupported_market_when_country_is_not_served():
    with pytest.raises(UnsupportedMarketError, match="country 'CN'"):
        market_codes(replace(EXAMPLE_MARKET, country='CN', language='zh-CN'))


@pytest.mark.parametrize('language', ['en', 'fr-FR', 'zh-HK'])
def test_raises_unsupported_market_when_language_is_not_served_for_country(language):
    with pytest.raises(UnsupportedMarketError, match='does not serve language'):
        market_codes(replace(EXAMPLE_MARKET, language=language))


# --- keyword_data_language ---------------------------------------------------------------------------------


def test_falls_back_to_country_default_when_serp_language_is_not_a_keyword_data_language():
    assert keyword_data_language(MarketCodes(2076, 'pt-BR', 'labs')) == 'pt'


def test_keeps_language_when_country_serves_it_for_keyword_data():
    assert keyword_data_language(MarketCodes(2840, 'es', 'labs')) == 'es'
