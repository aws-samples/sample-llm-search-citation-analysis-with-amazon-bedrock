"""The dashboard's DataForSEO price table matches the one the Lambdas bill with.

``web/src/components/Seo/seoPrices.ts`` shows the ceiling of a Keyword Explorer
search before it runs (the research route answers no estimate before the call).
Its constants must equal ``shared.dataforseo_pricing`` and the research cache
of ``seo/seo-keywords.py``; a price changed on one side only fails here.
"""

from __future__ import annotations

import re
from pathlib import Path

from shared.dataforseo_pricing import GOOGLE_ADS_LIVE_TASK_USD, LABS_ROW_USD, LABS_TASK_USD

_ROOT = Path(__file__).resolve().parents[2]
_WEB_PRICES = _ROOT / 'web' / 'src' / 'components' / 'Seo' / 'seoPrices.ts'
_KEYWORDS_ROUTE = _ROOT / 'lambda' / 'seo' / 'seo-keywords.py'


def _web_constant(name: str) -> float:
    match = re.search(rf'^(?:export )?const {name} = ([0-9.]+);$', _WEB_PRICES.read_text(encoding='utf-8'), flags=re.MULTILINE)
    assert match is not None, f'{name} not found in seoPrices.ts'
    return float(match.group(1))


def _research_cache_seconds() -> int:
    match = re.search(r"^RESEARCH_CACHE = CachePolicy\(.*ttl_seconds=([0-9_]+)\)$", _KEYWORDS_ROUTE.read_text(encoding='utf-8'), flags=re.MULTILINE)
    assert match is not None, 'RESEARCH_CACHE not found in seo-keywords.py'
    return int(match.group(1).replace('_', ''))


def test_the_dashboard_prices_keyword_research_as_the_lambdas_bill_it():
    assert (_web_constant('LABS_TASK_USD'), _web_constant('LABS_ROW_USD'), _web_constant('GOOGLE_ADS_RESEARCH_USD')) == (
        LABS_TASK_USD, LABS_ROW_USD, GOOGLE_ADS_LIVE_TASK_USD,
    )


def test_the_dashboard_states_the_research_cache_the_lambdas_keep():
    assert _web_constant('RESEARCH_CACHE_HOURS') * 3600 == _research_cache_seconds()
