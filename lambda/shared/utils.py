"""Utility functions for Lambda functions."""

import logging
import os
import unicodedata
import uuid
from datetime import UTC, datetime
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse

import boto3

# Set up logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Wire format for ISO 8601 UTC timestamps across the system. Downstream callers
# (DynamoDB sort keys, API clients, S3 keys) rely on the trailing 'Z' suffix,
# so `datetime.now(UTC)` output is normalized by replacing '+00:00' with 'Z'.
# DO NOT change this format without coordinating with every consumer.
_UTC_SUFFIX_NATIVE = '+00:00'
_UTC_SUFFIX_WIRE = 'Z'

# Explicit browser/Lambda keyword boundary contract. It is the union of
# Unicode White_Space and U+FEFF BOM, without Python's extra U+001C-U+001F
# separators. Keeping the set explicit prevents runtime-specific trim drift.
_KEYWORD_BOUNDARY_CODEPOINTS = frozenset({
    *range(0x0009, 0x000E),
    0x0020,
    0x0085,
    0x00A0,
    0x1680,
    *range(0x2000, 0x200B),
    0x2028,
    0x2029,
    0x202F,
    0x205F,
    0x3000,
    0xFEFF,
})
_KEYWORD_ID_PREFIX = 'citation-analysis:keyword:'

# DynamoDB resource (lazy initialization)
_dynamodb = None


def get_dynamodb_resource():
    """Lazy shared DynamoDB resource — import stays side-effect free.

    The single home for the lazy-resource idiom that was previously
    duplicated in ``shared.providers`` (bugs.md 3.4).
    """
    global _dynamodb
    if _dynamodb is None:
        _dynamodb = boto3.resource('dynamodb')
    return _dynamodb


def is_unicode_scalar_text(text: object) -> bool:
    """Return whether text contains no unpaired surrogate code points."""
    return isinstance(text, str) and all(
        not 0xD800 <= ord(character) <= 0xDFFF for character in text
    )


def trim_keyword(text: str) -> str:
    """Trim only the explicit cross-runtime keyword boundary set."""
    start = 0
    end = len(text)

    while start < end and ord(text[start]) in _KEYWORD_BOUNDARY_CODEPOINTS:
        start += 1
    while end > start and ord(text[end - 1]) in _KEYWORD_BOUNDARY_CODEPOINTS:
        end -= 1

    return text[start:end]


def normalize_keyword(text: str) -> str:
    """Return the canonical scalar-safe identity shared by keyword routes.

    Known accepted limitation: NFKC and lowercase use the runtime's Unicode
    tables, so code points assigned after the deployed runtime's Unicode
    version can canonicalize differently across runtimes.
    """
    if not is_unicode_scalar_text(text):
        return ''

    normalized = unicodedata.normalize('NFKC', text)
    return trim_keyword(normalized).lower()


def keyword_id(keyword: str) -> str:
    """Return the deterministic primary key for a canonical keyword identity."""
    identity = normalize_keyword(keyword)
    if not identity:
        raise ValueError('Keyword must have a non-empty Unicode identity')
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f'{_KEYWORD_ID_PREFIX}{identity}'))


def load_keyword_identities(table: Any) -> set[str]:
    """Read all canonical keyword identities with strongly consistent pages.

    The scan preserves compatibility with pre-existing UUIDv4 rows. New writes
    use ``keyword_id`` plus a conditional put, so concurrent current-version
    writers converge on one primary key after this legacy check.
    """
    identities: set[str] = set()
    scan_params: dict[str, Any] = {
        'ProjectionExpression': '#kw',
        'ExpressionAttributeNames': {'#kw': 'keyword'},
        'ConsistentRead': True,
    }

    while True:
        response = table.scan(**scan_params)

        for item in response.get('Items', []):
            stored_keyword = item.get('keyword')
            if not isinstance(stored_keyword, str):
                continue
            identity = normalize_keyword(stored_keyword)
            if identity:
                identities.add(identity)

        last_key = response.get('LastEvaluatedKey')
        if not last_key:
            return identities

        scan_params['ExclusiveStartKey'] = last_key


def get_brand_config(table_name: str | None = None) -> dict[str, Any]:
    """
    Get brand tracking configuration from DynamoDB.

    Args:
        table_name: Optional table name override. If not provided,
                   uses DYNAMODB_TABLE_BRAND_CONFIG environment variable.

    Returns:
        Brand configuration dictionary or empty dict if not found/error.
    """
    brand_config_table = table_name or os.environ.get('DYNAMODB_TABLE_BRAND_CONFIG')
    if not brand_config_table:
        return {}
    try:
        dynamodb = get_dynamodb_resource()
        table = dynamodb.Table(brand_config_table)
        response = table.get_item(Key={'config_id': 'default'})
        return response.get('Item', {})
    except Exception as e:
        logger.error(f"Error getting brand config: {e}")
        return {}


def normalize_url(url: str) -> str:
    """
    Normalize URL by removing tracking parameters.

    Args:
        url: Original URL with potential tracking parameters

    Returns:
        Normalized URL with tracking parameters removed
    """
    try:
        parsed = urlparse(url)

        # Remove tracking parameters
        query_params = parse_qs(parsed.query)
        tracking_params = [
            'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
            'fbclid', 'gclid', 'msclkid', 'ref', 'source', '_ga', 'mc_cid', 'mc_eid'
        ]
        clean_params = {k: v for k, v in query_params.items()
                       if k not in tracking_params}

        # Rebuild URL with domain + path + clean params
        clean_query = urlencode(clean_params, doseq=True)
        normalized = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
        if clean_query:
            normalized += f"?{clean_query}"

        return normalized
    except Exception as e:
        logger.warning(f"Error normalizing URL {url}: {e}")
        return url


def utc_now() -> datetime:
    """Return current time as a timezone-aware UTC datetime.

    Use this anywhere the legacy code called `datetime.utcnow()`. The return
    is timezone-aware (tzinfo=UTC), so arithmetic against it must use other
    timezone-aware datetimes. Use `.replace(tzinfo=None)` only when comparing
    against naive datetimes parsed from stored ISO strings.
    """
    return datetime.now(UTC)


def get_timestamp() -> str:
    """Return current UTC time as an ISO 8601 string with a trailing 'Z'.

    Wire format: `YYYY-MM-DDTHH:MM:SS.ffffffZ` (microsecond precision). This
    is the canonical wire format for DynamoDB sort keys, API responses, and
    S3 object metadata in this project. Downstream code parses with either
    `fromisoformat(s.replace('Z', '+00:00'))` or strict prefix matching.
    """
    return utc_now().isoformat().replace(_UTC_SUFFIX_NATIVE, _UTC_SUFFIX_WIRE)


def get_timestamp_compact() -> str:
    """Return current UTC time as `YYYYMMDD-HHMMSS`.

    Used for S3 object prefixes and Step Functions execution names where a
    filesystem-safe, lexicographically-sortable stamp is required. Second
    precision — if you need more, use `get_timestamp()` and munge.
    """
    return utc_now().strftime('%Y%m%d-%H%M%S')


def extract_domain(url: str) -> str:
    """
    Extract a normalized domain from a URL.

    Normalization:
    - Lowercase
    - Strip leading ``www.`` (matches the convention in every current
      caller so downstream comparisons like
      ``domain == first_party_domains[i]`` are predictable)

    Args:
        url: URL to extract domain from

    Returns:
        Lowercase domain without leading ``www.``. Returns an empty string
        when ``urlparse`` finds no ``netloc`` (e.g. ``"not a url"`` or
        ``""``) or when input is not a string. On the rare ``urlparse``
        exception, returns ``url`` verbatim if it is a string, else ``""``.

        The previous shared implementation returned the literal string
        ``'unknown'`` on failure which silently bucketed every parse
        error into the same domain. Callers that want a sentinel should
        substitute one at the call site.
    """
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        if domain.startswith('www.'):
            domain = domain[4:]
        return domain
    except Exception:
        return url if isinstance(url, str) else ""


def brand_names_match(candidate: str, tracked: str) -> bool:
    """Safely test whether two brand names refer to the same brand.

    Designed as a fallback for classification logic when a brand extraction
    record is missing the authoritative `classification` field. Uses
    normalized exact matching — NOT substring matching — so `"Inn"`
    does not match `"Holiday Inn"` or `"linkedin.com"`.

    Normalization:
    - Lowercase
    - Strip leading/trailing whitespace
    - Collapse internal whitespace runs into a single space

    Returns False for any non-string input.
    """
    if not isinstance(candidate, str) or not isinstance(tracked, str):
        return False

    def _norm(s: str) -> str:
        return " ".join(s.lower().split())

    c = _norm(candidate)
    t = _norm(tracked)
    if not c or not t:
        return False
    return c == t


def recommendation_id(recommendation: dict[str, Any]) -> str:
    """
    Compute a deterministic stable id for a recommendation.

    Recommendations are produced by `generate_rule_based_recommendations`
    and aren't stored in DynamoDB themselves — every list call regenerates
    them. To track per-recommendation status (acknowledged / done /
    won't fix) we need a stable identifier that doesn't drift across
    calls. The hash inputs are the immutable parts of a recommendation:
    type, title, and the keywords list (sorted). Wording in `description`
    or `action` is excluded because those tend to be slightly different
    between rule iterations even when the underlying recommendation is
    semantically the same.

    Returns the SHA-1 hex digest, truncated to 16 characters. Truncation
    is fine: the inputs come from a small enumerated space (a few rule
    types x a few hundred keywords) and 64 bits of hash gives a
    collision probability low enough for our scale.
    """
    import hashlib
    rec_type = (recommendation.get('type') or '').strip().lower()
    title = (recommendation.get('title') or '').strip().lower()
    keywords = recommendation.get('keywords') or []
    keyword_part = '|'.join(sorted(str(k).strip().lower() for k in keywords))
    payload = f"{rec_type}::{title}::{keyword_part}".encode()
    return hashlib.sha1(payload, usedforsecurity=False).hexdigest()[:16]
