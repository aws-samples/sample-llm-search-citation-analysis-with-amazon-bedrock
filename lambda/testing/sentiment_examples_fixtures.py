"""Stored SearchResults rows and a SearchResults table stub for the sentiment-examples tests.

Shared by ``shared/test_sentiment_examples.py`` (the selection) and
``api/test_get_sentiment_examples.py`` (the endpoint).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any
from unittest.mock import MagicMock

from hypothesis import strategies as st

from testing.dynamodb_stubs import fake_dynamodb_resource, fake_table

RUN = '2026-09-28T10:00:00.000000Z'
OLDER_RUN = '2026-09-21T10:00:00.000000Z'


def stored_brand(
    name: str,
    sentiment: object = 'negative',
    *,
    classification: str = 'first_party',
    rank: object = 1,
    **fields: object,
) -> dict[str, Any]:
    """One brand dict as the search step stores it; ``fields`` adds quote, reason, ranking context ..."""
    return {'name': name, 'classification': classification, 'rank': rank, 'sentiment': sentiment, **fields}


def stored_answer(
    keyword: str,
    provider: str,
    brands: Sequence[Mapping[str, Any]],
    *,
    timestamp: str = RUN,
    **fields: object,
) -> dict[str, Any]:
    """One SearchResults row of a successful answer; ``fields`` adds or overrides attributes (``response`` ...)."""
    persona = str(fields.get('query_prompt_id', 'default'))
    return {
        'keyword': keyword,
        'timestamp': timestamp,
        'timestamp_provider': f'{timestamp}#{provider}#{persona}',
        'provider': provider,
        'status': 'success',
        'query_prompt_id': persona,
        'brands': [dict(brand) for brand in brands],
        'citations': [],
        **fields,
    }


class PartitionReadFailure(Exception):
    """A SearchResults partition that cannot be read."""


def search_results_stub(rows_by_keyword: Mapping[str, Sequence[Mapping[str, Any]] | Exception]) -> MagicMock:
    """A SearchResults ``Table`` answering the latest-run lookup and the run read from ``rows_by_keyword``.

    A keyword mapped to an exception raises it on every read. The sort-key
    condition, when present, is read as a prefix (``begins_with``); newest-first
    reads with ``Limit`` return the newest rows.
    """

    def query(**kwargs: Any) -> dict[str, Any]:
        expression = kwargs['KeyConditionExpression'].get_expression()
        conditions = expression['values'] if expression['operator'] == 'AND' else (kwargs['KeyConditionExpression'],)
        keyword = conditions[0].get_expression()['values'][1]
        prefix = conditions[1].get_expression()['values'][1] if len(conditions) > 1 else ''
        stored = rows_by_keyword.get(keyword, [])
        if isinstance(stored, Exception):
            raise stored
        rows = sorted(
            (dict(row) for row in stored if row['timestamp_provider'].startswith(prefix)),
            key=lambda row: row['timestamp_provider'],
            reverse=not kwargs.get('ScanIndexForward', True),
        )
        return {'Items': rows[:kwargs.get('Limit', len(rows))]}

    table = MagicMock(name='search-results')
    table.query.side_effect = query
    return table


def examples_dynamodb(search_table: MagicMock, active_keywords: Sequence[Mapping[str, Any]] = ()) -> MagicMock:
    """A DynamoDB resource: ``test-search-results`` is ``search_table``, ``test-keywords`` lists ``active_keywords``.

    Every other table name answers empty pages, so a handler reading the
    wrong table finds nothing instead of paginating a bare ``MagicMock`` forever.
    """
    return fake_dynamodb_resource(
        fake_table(query={'Items': []}),
        by_name={'test-search-results': search_table, 'test-keywords': fake_table(query={'Items': list(active_keywords)})},
    )



# Brand dicts as models write them: names that collide across case, every
# classification, ranks the KPI engine accepts or rejects, labels in and out of the four.
STORED_BRANDS = st.fixed_dictionaries(
    {
        'name': st.sampled_from(['Hotel Sol', 'hotel sol', 'Hotel Mar', 'Rival Inn', '']),
        'classification': st.sampled_from(['first_party', 'competitor', 'other']),
        'rank': st.sampled_from([None, 1, 2, 3, '2', 'first', 999, True]),
        'sentiment': st.sampled_from(['positive', 'neutral', 'mixed', 'negative', 'Negative', 'great', None]),
    },
    optional={'sentiment_quote': st.sampled_from(['Rooms feel dated.', '', '  '])},
)

# SearchResults rows of one run: answers of every AI engine, web-search rows and failed calls.
STORED_ROWS = st.lists(
    st.builds(
        stored_answer,
        keyword=st.sampled_from(['hotel sol spa', 'Hotel Sol beach']),
        provider=st.sampled_from(['openai', 'perplexity', 'gemini', 'claude', 'brave']),
        brands=st.lists(STORED_BRANDS, max_size=5),
        status=st.sampled_from(['success', 'error']),
    ),
    max_size=8,
)
