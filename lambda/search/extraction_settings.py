"""
Which brand config the brand extraction runs with: shared by a run's search step (``handler.py``) and the re-extract
worker (``reextract_worker.py``), so a re-extracted answer is read exactly as a new one would be.
"""

from __future__ import annotations

import functools
import json
import logging
import os
from typing import Any

from brand_extractor import DEFAULT_EXTRACTION_CONFIG
from shared.markets import Market, brand_config_for_market

logger = logging.getLogger(__name__)


@functools.cache
def get_extraction_config() -> dict[str, Any]:
    """``extraction_config.json`` next to this module (read once); the defaults when it cannot be read."""
    try:
        config_path = os.path.join(os.path.dirname(__file__), 'extraction_config.json')
        with open(config_path, encoding='utf-8') as f:
            loaded = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        logger.warning('Failed to load extraction config: %s, using defaults', e)
        return {"brand_extraction": {"enabled": True, "config": {}}}
    logger.info("Loaded extraction config")
    return loaded


def extraction_enabled() -> bool:
    """Whether brands are extracted at all (``brand_extraction.enabled`` of the extraction config)."""
    return bool(get_extraction_config().get("brand_extraction", {}).get("enabled", True))


def extraction_brand_config(market: Market | None, stored: dict[str, Any]) -> dict[str, Any] | None:
    """The brand config extraction uses (``market``'s competitors and aliases added), or ``None`` when extraction is off.

    Without a market it is the stored config as is; with one, the stored
    config (the extractor's defaults when nothing is stored) plus the
    market's extra names.
    """
    if not extraction_enabled():
        return None
    brand_config = brand_config_for_market(stored or DEFAULT_EXTRACTION_CONFIG, market) if market else stored
    logger.info('Loaded brand config for extraction: industry=%s', (brand_config or {}).get('industry') or 'default')
    return brand_config
