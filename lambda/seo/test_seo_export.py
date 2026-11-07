"""``seo_export``: the export window of a paged SEO table request and the ``export`` price block."""

from __future__ import annotations

import pytest
from seo_export import EXPORT_MAX_ROWS, ExportWindowError, RowWindow, export_pricing, row_window


def test_reads_a_request_without_limit_as_its_page():
    window = row_window({}, page=3, page_size=100, offset=None, limit=None)

    assert window == RowWindow(offset=200, limit=100, exported=False)


def test_accepts_a_window_ending_exactly_at_the_export_maximum():
    window = row_window({'offset': 9000, 'limit': 1000}, page=1, page_size=50, offset=9000, limit=1000)

    assert (window.offset + window.limit, window.exported) == (EXPORT_MAX_ROWS, True)


def test_refuses_a_window_one_row_past_the_maximum_on_limit():
    with pytest.raises(ExportWindowError, match='offset \\+ limit must be at most 10000') as raised:
        row_window({'offset': 9001, 'limit': 1000}, page=1, page_size=50, offset=9001, limit=1000)

    assert raised.value.field == 'limit'


def test_accepts_a_whole_float_limit():
    window = row_window({'limit': 1000.0}, page=1, page_size=50, offset=None, limit=1000)

    assert (window.offset, window.limit) == (0, 1000)


def test_keys_a_page_as_page_and_page_size():
    assert RowWindow(offset=200, limit=100, exported=False).cache_key == {'page': 3, 'page_size': 100}


def test_keys_a_chunk_as_offset_and_limit():
    assert RowWindow(offset=200, limit=100, exported=True).cache_key == {'offset': 200, 'limit': 100}


def test_prices_with_the_given_request_and_row_constants():
    assert export_pricing(0.024, 0.000036) == {
        'max_rows': 10_000, 'rows_per_request': 1000, 'request_usd': 0.024, 'row_usd': 0.000036,
    }
