"""
Tests for shared.dynamo_decimal.

The module consolidates the three Decimal-handling homes from bugs.md 3.4
(``search/handler.py:convert_floats_to_decimal``,
``api/decimal_utils.py:to_int``, ``api_response.DecimalEncoder``). These
tests pin the consolidated behavior each caller relies on.
"""

from __future__ import annotations

import json
from decimal import Decimal

import pytest

from shared.dynamo_decimal import DecimalEncoder, convert_floats_to_decimal, positive_int, to_int


class TestToInt:
    def test_converts_decimal_to_int(self):
        assert to_int(Decimal(7)) == 7

    def test_returns_default_when_value_is_none(self):
        assert to_int(None, default=3) == 3

    def test_returns_default_for_unparseable_value(self):
        assert to_int('not a number', default=5) == 5

    def test_returns_default_for_falsy_values(self):
        assert to_int('', default=2) == 2

    def test_truncates_numeric_strings_via_int_conversion(self):
        assert to_int('41') == 41


class TestPositiveInt:
    @pytest.mark.parametrize(('value', 'expected'), [
        pytest.param(1, 1, id='one'),
        pytest.param(42, 42, id='larger-int'),
        pytest.param(0, None, id='zero'),
        pytest.param(-3, None, id='negative'),
        pytest.param(True, None, id='bool'),
        pytest.param(2.0, None, id='float'),
        pytest.param('3', None, id='numeric-string'),
        pytest.param(Decimal(3), None, id='decimal'),
        pytest.param(None, None, id='missing'),
    ])
    def test_reads_only_ints_of_at_least_one(self, value, expected):
        assert positive_int(value) == expected


class TestConvertFloatsToDecimal:
    def test_converts_nested_floats_via_string_repr(self):
        converted = convert_floats_to_decimal(
            {'score': 1.5, 'items': [2.25, {'inner': 3.5}]}
        )

        assert converted == {
            'score': Decimal('1.5'),
            'items': [Decimal('2.25'), {'inner': Decimal('3.5')}],
        }

    def test_leaves_non_float_values_untouched(self):
        payload = {'count': 7, 'name': 'alpha', 'flags': [True, None]}

        assert convert_floats_to_decimal(payload) == payload


class TestDecimalEncoder:
    def test_serializes_decimal_as_json_number(self):
        assert json.dumps({'n': Decimal('2.5')}, cls=DecimalEncoder) == '{"n": 2.5}'

    def test_raises_type_error_for_unsupported_types(self):
        with pytest.raises(TypeError):
            json.dumps({'x': object()}, cls=DecimalEncoder)
