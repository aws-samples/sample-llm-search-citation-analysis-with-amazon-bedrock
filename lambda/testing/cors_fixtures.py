"""A pinned CORS origin and the headers ``shared.api_response`` answers with for it."""

from __future__ import annotations

import importlib
import os
from collections.abc import Iterator
from contextlib import contextmanager
from unittest.mock import patch

CONFIGURED_ORIGIN = 'https://dashboard.example.com'


def credentialed_json_headers(origin: str) -> dict[str, str]:
    """``cors_json_headers`` for a request whose origin is allowed and echoed back."""
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Api-Key',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Credentials': 'true',
        'Vary': 'Origin',
    }


@contextmanager
def configured_cors_origin(*, allow_localhost: bool = False) -> Iterator[None]:
    """Serve ``CONFIGURED_ORIGIN`` from the warm-container cache, optionally allowing localhost too."""
    # `shared/__init__.py` re-exports the `api_response` function; patch the submodule.
    api_response_module = importlib.import_module('shared.api_response')
    allow = 'true' if allow_localhost else 'false'
    with patch.object(api_response_module, '_cors_origin_cache', CONFIGURED_ORIGIN), \
         patch.dict(os.environ, {'ALLOW_LOCALHOST': allow}):
        yield
