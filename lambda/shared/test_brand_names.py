"""Tests for shared/brand_names.py — one identity per brand, the configured spelling for a tracked one."""

from __future__ import annotations

from copy import deepcopy

import pytest
from hypothesis import given
from hypothesis import strategies as st

from shared.brand_names import BrandIndex, canonicalize_brands, normalize_brand_key

#: An airline's configuration: the brand under its name and a lower-case alias, three competitors.
AIRLINE_INDEX = BrandIndex(['Altiplano Air', 'altiplano'], ['Sky Airline', 'Condor Sur', 'American Airlines'])
SKY_AIRLINE = ('Sky Airline', 'competitor')


class TestNormalizeBrandKey:
    @pytest.mark.parametrize(('name', 'key'), [
        pytest.param('Sky Airline', 'sky airline', id='lower-cases'),
        pytest.param('SKY AIRLINE', 'sky airline', id='folds-case'),
        pytest.param('Aerolínea Cóndor', 'aerolinea condor', id='drops-accents'),
        pytest.param('Sky\u00a0Airline', 'sky airline', id='no-break-space'),
        pytest.param('Sky  \t Airline', 'sky airline', id='collapses-inner-whitespace'),
        pytest.param('  Sky Airline \n', 'sky airline', id='strips-outer-whitespace'),
        pytest.param('Sky Airline®', 'sky airline', id='registered-mark'),
        pytest.param('Sky Airline™', 'sky airline', id='trademark-mark'),
        pytest.param('Sky Airline.', 'sky airline', id='trailing-full-stop'),
        pytest.param('Sky Airline ® .', 'sky airline', id='trailing-marks-and-spaces'),
        pytest.param('\uff33\uff4b\uff59 \uff21\uff49\uff52\uff4c\uff49\uff4e\uff45', 'sky airline', id='full-width-letters'),
        pytest.param('Sky S.A.', 'sky s.a', id='keeps-inner-punctuation'),
        pytest.param('', '', id='empty'),
        pytest.param(' ® ', '', id='only-marks'),
    ])
    def test_gives_every_spelling_of_a_brand_the_same_key(self, name: str, key: str) -> None:
        assert normalize_brand_key(name) == key

    def test_gives_the_accented_and_the_plain_spelling_one_key(self) -> None:
        assert normalize_brand_key('Aerolínea') == normalize_brand_key('Aerolinea')

    @given(st.text())
    def test_is_idempotent(self, name: str) -> None:
        key = normalize_brand_key(name)

        assert normalize_brand_key(key) == key

    @given(st.text())
    def test_never_keeps_leading_or_trailing_whitespace(self, name: str) -> None:
        key = normalize_brand_key(name)

        assert key == key.strip()


class TestBrandIndexCanonical:
    @pytest.mark.parametrize(('name', 'expected'), [
        pytest.param('Sky Airline', SKY_AIRLINE, id='configured-spelling'),
        pytest.param('SKY Airline', SKY_AIRLINE, id='other-case'),
        pytest.param(' sky airline ', SKY_AIRLINE, id='other-whitespace'),
        pytest.param('Sky', SKY_AIRLINE, id='first-word-of-one-brand'),
        pytest.param('Sky Airline S.A.', SKY_AIRLINE, id='brand-is-the-first-words'),
        pytest.param('American', ('American Airlines', 'competitor'), id='american-is-american-airlines'),
        pytest.param('Condor', ('Condor Sur', 'competitor'), id='condor-is-condor-sur'),
        pytest.param('Altiplano Air', ('Altiplano Air', 'first_party'), id='first-party'),
        pytest.param('ALTIPLANO', ('Altiplano Air', 'first_party'), id='an-alias-answers-the-first-configured-name'),
        pytest.param('Altiplano Airlines', ('Altiplano Air', 'first_party'), id='company-word-variant-is-the-first-configured-alias'),
        pytest.param('Skyline', None, id='not-a-whole-word'),
        pytest.param('JetPuma', None, id='unknown'),
        pytest.param('', None, id='empty'),
        pytest.param('®', None, id='only-a-mark'),
    ])
    def test_names_the_configured_brand_a_spelling_stands_for(self, name: str, expected: tuple[str, str] | None) -> None:
        assert AIRLINE_INDEX.canonical(name) == expected

    def test_matches_nothing_when_a_first_word_fits_two_brands(self) -> None:
        index = BrandIndex([], ['Sky Andes', 'Sky Peru'])

        assert (index.canonical('Sky'), index.canonical('Sky Andes')) == (None, ('Sky Andes', 'competitor'))

    def test_treats_a_brand_configured_on_both_sides_as_first_party(self) -> None:
        index = BrandIndex(['Condor Sur'], ['condor sur'])

        assert index.canonical('CONDOR SUR') == ('Condor Sur', 'first_party')

    def test_strips_the_configured_spelling_it_returns(self) -> None:
        assert BrandIndex([], [' Sky Airline ']).canonical('sky airline') == SKY_AIRLINE


#: A hotel chain's configuration: the chain under three aliases, one property tracked by name, one competitor chain.
HOTEL_INDEX = BrandIndex(
    ['Costamar', 'Costamar Hotels', 'Costamar Hotel Company', 'Costamar Torre Norte'], ['Brisa Hoteles'],
)
COSTAMAR = ('Costamar', 'first_party')


class TestHotelProperties:
    @pytest.mark.parametrize(('name', 'expected'), [
        pytest.param('Costamar', COSTAMAR, id='the-chain'),
        pytest.param('COSTAMAR HOTELS', COSTAMAR, id='a-configured-alias-is-the-first-alias'),
        pytest.param('Costamar Hotels S.A.', COSTAMAR, id='an-alias-with-a-legal-form-is-the-first-alias'),
        pytest.param('Costamar Torre Norte Hotel', ('Costamar Torre Norte', 'first_party'), id='a-tracked-property'),
        pytest.param('Brisa', ('Brisa Hoteles', 'competitor'), id='the-competitor-by-its-first-word'),
        pytest.param('Costamar Ciudad de Lugo', None, id='a-property-is-not-the-chain'),
        pytest.param('Brisa Plaza Lugo', None, id='a-competitor-property-is-not-the-competitor'),
    ])
    def test_a_property_named_after_its_chain_is_not_another_spelling_of_the_chain(self, name, expected) -> None:
        assert HOTEL_INDEX.canonical(name) == expected

    @pytest.mark.parametrize(('name', 'owner'), [
        pytest.param('Costamar Ciudad de Lugo', COSTAMAR, id='first-party-property'),
        pytest.param('Costamar Torre Norte Suites', ('Costamar Torre Norte', 'first_party'), id='longest-tracked-name-owns-it'),
        pytest.param('Brisa Hoteles Plaza', ('Brisa Hoteles', 'competitor'), id='competitor-property'),
        pytest.param('Costamar', None, id='the-chain-owns-not-itself'),
        pytest.param('Hotel Riazul', None, id='an-independent-hotel'),
    ])
    def test_names_the_tracked_brand_a_property_belongs_to(self, name, owner) -> None:
        assert HOTEL_INDEX.owner(name) == owner

    def test_every_property_of_the_chain_keeps_its_own_row_under_the_chain(self) -> None:
        brands = [
            {'name': 'Costamar Ciudad de Lugo', 'classification': 'other', 'parent_company': None},
            {'name': 'Costamar Atlántico', 'classification': 'other', 'parent_company': 'Costamar Hotel Company'},
            {'name': 'Costamar Hotels', 'classification': 'other'},
        ]

        canonicalize_brands(brands, HOTEL_INDEX)

        assert [(brand['name'], brand['classification'], brand.get('parent_company')) for brand in brands] == [
            ('Costamar Ciudad de Lugo', 'first_party', 'Costamar'),
            ('Costamar Atlántico', 'first_party', 'Costamar Hotel Company'),
            ('Costamar', 'first_party', None),
        ]

    @pytest.mark.parametrize(('index', 'name'), [
        pytest.param(AIRLINE_INDEX, 'Sky Hotels', id='a-hotel-is-not-the-airline'),
        pytest.param(AIRLINE_INDEX, 'Altiplano Hotels', id='a-hotel-is-not-a-bare-alias-of-the-airline'),
        pytest.param(BrandIndex([], ['Northwind Airlines']), 'Northwind Hotels', id='another-industry-same-first-word'),
        pytest.param(HOTEL_INDEX, 'Costamar Airlines', id='an-airline-is-not-the-hotel-chain'),
    ])
    def test_industry_words_never_join_two_businesses(self, index: BrandIndex, name: str) -> None:
        assert index.canonical(name) is None

    def test_aliases_on_both_sides_name_nothing(self) -> None:
        index = BrandIndex(['Lumen Hotels'], ['Lumen Group'])

        assert index.canonical('Lumen') is None


class TestBrandIndexFromConfig:
    def test_reads_both_tracked_lists_and_skips_what_is_not_a_name(self) -> None:
        index = BrandIndex.from_config({'tracked_brands': {
            'first_party': ['Altiplano Air', '', '  ', 7, None],
            'competitors': ['Condor Sur'],
        }})

        assert (index.canonical('altiplano air'), index.canonical('condor sur')) == (
            ('Altiplano Air', 'first_party'), ('Condor Sur', 'competitor'),
        )

    @pytest.mark.parametrize('config', [
        pytest.param(None, id='no-config'),
        pytest.param({}, id='empty-config'),
        pytest.param({'tracked_brands': 'Sky Airline'}, id='tracked-brands-not-a-mapping'),
        pytest.param({'tracked_brands': {'competitors': 'Sky Airline'}}, id='list-not-a-list'),
    ])
    def test_knows_no_brand_without_tracked_lists(self, config) -> None:
        assert BrandIndex.from_config(config).canonical('Sky Airline') is None


class TestCanonicalizeBrands:
    def test_rewrites_a_tracked_brand_to_its_configured_spelling_and_classification(self) -> None:
        brands = [{'name': 'SKY Airline', 'classification': 'other', 'rank': 1}]

        canonicalize_brands(brands, AIRLINE_INDEX)

        assert brands == [{'name': 'Sky Airline', 'classification': 'competitor', 'rank': 1}]

    def test_leaves_a_brand_it_does_not_know_as_the_model_named_it(self) -> None:
        brands = [
            {'name': 'JetPuma', 'classification': 'other', 'rank': 2},
            {'name': 7, 'classification': 'competitor'},
            {'classification': 'competitor'},
        ]
        before = deepcopy(brands)

        canonicalize_brands(brands, AIRLINE_INDEX)

        assert brands == before

    def test_returns_the_same_list_rewritten_in_place(self) -> None:
        brands = [{'name': 'Sky'}, {'name': 'Condor Sur', 'classification': 'other'}]

        result = canonicalize_brands(brands, AIRLINE_INDEX)

        assert result is brands
        assert result == [
            {'name': 'Sky Airline', 'classification': 'competitor'},
            {'name': 'Condor Sur', 'classification': 'competitor'},
        ]
