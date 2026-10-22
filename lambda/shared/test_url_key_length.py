"""``normalize_url`` keeps every citation URL within DynamoDB's 1,024-byte sort-key cap.

A Google Travel hotel link with an opaque ``ap=`` state blob reached the
deduplication Lambda at about 1.4 KB and its Citations write failed with
"Aggregated size of all range keys has exceeded the size limit of 1024 bytes".
"""

from __future__ import annotations

from hypothesis import given
from hypothesis import strategies as st

from shared.utils import MAX_NORMALIZED_URL_BYTES, bounded_url, normalize_url

PAGE = 'https://www.google.com/travel/hotels/entity/ChkI0LLgzKOTzNegARoML2cvMXE2MjlkNDc2EAE'
STATE_BLOB = 'EgRDTFFCMANaywMKBAhGEAAiA1VTRCoWCgcI5g8QBhgWEgcI5g8QBhgdGAcgAUgIWAFoAXIECAIYAJIBAiAB' * 20


def test_keeps_a_url_that_fits_unchanged():
    assert normalize_url(f'{PAGE}?hl=es') == f'{PAGE}?hl=es'


def test_drops_an_oversized_query_and_keeps_the_page_address():
    assert normalize_url(f'{PAGE}?ap={STATE_BLOB}') == PAGE


def test_cuts_an_oversized_path_to_the_cap_with_a_digest_suffix():
    key = normalize_url('https://example.com/' + 'a' * 2_000)

    assert (len(key.encode('utf-8')), key.startswith('https://example.com/aaa'), key[-17]) == (
        MAX_NORMALIZED_URL_BYTES, True, '#',
    )


def test_gives_two_long_urls_with_the_same_prefix_different_keys():
    first = bounded_url('https://example.com/' + 'a' * 2_000 + 'one')
    second = bounded_url('https://example.com/' + 'a' * 2_000 + 'two')

    assert first != second


def test_never_splits_a_multi_byte_character_when_cutting():
    key = bounded_url('https://example.com/' + 'ñ' * 1_000)

    assert key.encode('utf-8').decode('utf-8') == key


@given(st.text(min_size=1, max_size=3_000))
def test_every_normalized_url_fits_the_sort_key_cap(path):
    assert len(normalize_url(f'https://example.com/{path}').encode('utf-8')) <= MAX_NORMALIZED_URL_BYTES
