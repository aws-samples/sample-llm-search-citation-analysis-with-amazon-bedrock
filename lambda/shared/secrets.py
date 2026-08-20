"""
Shared Secrets Manager access for API keys.

Consolidates the two divergent ``get_secret`` copies that previously lived
in ``search/handler.py`` and ``api/keyword-research.py`` (bugs.md 1.2).
The search copy only accepted JSON secrets with an ``api_key`` field while
the keyword-research copy also fell back to the raw secret string (and
cached the ``'placeholder'`` sentinel), so a plain-string secret worked for
keyword research but silently disabled the same provider in search. This
module is the single source of truth for prefixing, both storage formats,
and placeholder filtering.
"""

from __future__ import annotations

import json
import logging
import os
import time

import boto3

logger = logging.getLogger(__name__)

# Sentinel stored for unconfigured providers. Must never reach a provider
# client as a real API key — callers rely on a falsy return to skip the
# provider.
_PLACEHOLDER = 'placeholder'

# Module-level TTL cache: full secret name -> (api_key, fetched_at).
# Only non-None results are cached so a provider configured mid-flight is
# picked up on the next lookup.
CACHE_TTL_SECONDS = 300
_cache: dict[str, tuple[str, float]] = {}

# Secrets Manager client (lazy initialization)
_secrets_client = None


def _get_secrets_client():
    """Get Secrets Manager client (lazy initialization)."""
    global _secrets_client
    if _secrets_client is None:
        _secrets_client = boto3.client('secretsmanager')
    return _secrets_client


def get_api_key(key_name: str) -> str | None:
    """Fetch an API key from Secrets Manager with TTL-based caching.

    The ``SECRETS_PREFIX`` env var (default ``'citation-analysis/'``) is
    read per call and prepended to ``key_name``, so callers pass bare names
    like ``'openai-key'``.

    Accepts both storage formats:
    - JSON SecretString with an ``api_key`` field
    - raw (plain-string) SecretString

    Returns ``None`` for missing secrets, empty values, and the literal
    ``'placeholder'`` sentinel, so any truthy return is a usable key and
    unconfigured providers are skipped. Never logs secret values — lookup
    failures log the exception type name only.
    """
    prefix = os.environ.get('SECRETS_PREFIX', 'citation-analysis/')
    full_name = f"{prefix}{key_name}"

    cached = _cache.get(full_name)
    if cached is not None:
        api_key, fetched_at = cached
        if time.time() - fetched_at < CACHE_TTL_SECONDS:
            return api_key
        del _cache[full_name]

    try:
        response = _get_secrets_client().get_secret_value(SecretId=full_name)
        secret_string = response.get('SecretString')
    except Exception as e:
        # Exception type only — messages can leak resource names or values.
        logger.warning("Secret lookup failed: %s", type(e).__name__)
        return None

    if not secret_string:
        return None

    try:
        secret_data = json.loads(secret_string)
        # Structured secret: use the api_key field. Any other parsed shape
        # (list, number, JSON-quoted string) is treated as a raw secret.
        api_key = secret_data.get('api_key') if isinstance(secret_data, dict) else secret_string
    except json.JSONDecodeError:
        api_key = secret_string

    if not api_key or api_key == _PLACEHOLDER:
        return None

    _cache[full_name] = (api_key, time.time())
    return api_key
