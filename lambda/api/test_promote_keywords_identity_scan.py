"""How ``promote-keywords.py`` reads the stored keywords it deduplicates promotions against."""

from unittest.mock import MagicMock

import pytest

from testing.promotion_fixtures import promotion_handler_fixture

promotion_handler = promotion_handler_fixture('promote_keywords_under_test_identity_scan')

STORED_CORUNA = {'id': 'legacy-random-id', 'keyword': 'Hotel Coruña'}


def test_scans_only_ids_and_keyword_texts_with_a_consistent_read(promotion_handler):
    table = MagicMock()
    table.scan.return_value = {'Items': []}

    promotion_handler.load_keyword_items_by_identity(table)

    assert table.scan.call_args.kwargs == {
        'ProjectionExpression': '#id, #kw',
        'ExpressionAttributeNames': {'#id': 'id', '#kw': 'keyword'},
        'ConsistentRead': True,
    }


@pytest.mark.parametrize(
    'malformed',
    [{'id': 7, 'keyword': 'Hotel Marino'}, {'id': 'kw-marino', 'keyword': 7}],
    ids=['non-string-id', 'non-string-keyword'],
)
def test_skips_a_malformed_stored_item_and_keeps_reading_the_rest(promotion_handler, malformed):
    table = MagicMock()
    table.scan.return_value = {'Items': [malformed, STORED_CORUNA]}

    items_by_identity = promotion_handler.load_keyword_items_by_identity(table)

    assert items_by_identity == {'hotel coruña': STORED_CORUNA}
