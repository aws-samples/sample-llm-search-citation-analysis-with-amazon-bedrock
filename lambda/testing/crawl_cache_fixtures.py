"""Shared test doubles for the crawl cache and the crawler that reads it."""

from __future__ import annotations

from botocore.exceptions import ClientError


def missing_cache_index_error() -> ClientError:
    """The ``ValidationException`` DynamoDB raises when the cache-scope index does not exist."""
    return ClientError({'Error': {'Code': 'ValidationException', 'Message': 'missing index'}}, 'Query')
