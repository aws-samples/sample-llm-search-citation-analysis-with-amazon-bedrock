"""Fixtures shared by the SEO API suites: the ``seo_http`` boundary every sub-handler reaches through.

``seo_http`` is imported by bare name, as in the Lambda task root, so the module
the tests patch is the one the loaded sub-handlers run.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from unittest.mock import MagicMock, patch

import pytest
import seo_http

from testing.seo_fixtures import BRAND_CONFIG, GLOBAL_CODES, brand_config_stub


@dataclass(frozen=True)
class SeoBoundary:
    """The stand-ins for the SEO cache, the market codes and the BrandConfig table."""

    get_cached: MagicMock
    put_cached: MagicMock
    market_codes: MagicMock
    brand_config_table: MagicMock


@pytest.fixture(autouse=True)
def seo_boundary() -> Iterator[SeoBoundary]:
    """An empty cache, global market codes, and a BrandConfig with one market and the example brand's domains."""
    boundary = SeoBoundary(
        get_cached=MagicMock(return_value=None),
        put_cached=MagicMock(),
        market_codes=MagicMock(return_value=GLOBAL_CODES),
        brand_config_table=brand_config_stub(**BRAND_CONFIG),
    )
    with patch.multiple(
        seo_http, get_cached=boundary.get_cached, put_cached=boundary.put_cached, market_codes=boundary.market_codes,
        brand_config_table=MagicMock(return_value=boundary.brand_config_table),
    ):
        yield boundary
