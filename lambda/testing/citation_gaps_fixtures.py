"""Loading ``api/get-citation-gaps.py`` for the citation-gaps tests."""

from __future__ import annotations

import os
from types import ModuleType

from testing.env import setdefault_env
from testing.module_loader import load_handler_module

_API_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'api')

# Table names the module reads at import time, so it loads without touching AWS.
CITATION_GAPS_ENV = {
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-search',
    'DYNAMODB_TABLE_CITATIONS': 'test-citations',
    'DYNAMODB_TABLE_CRAWLED_CONTENT': 'test-crawled',
}


def load_citation_gaps(module_name: str) -> ModuleType:
    """``get-citation-gaps.py`` loaded as ``module_name``, its table names defaulted first."""
    setdefault_env(CITATION_GAPS_ENV)
    return load_handler_module(_API_DIR, 'get-citation-gaps.py', module_name)
