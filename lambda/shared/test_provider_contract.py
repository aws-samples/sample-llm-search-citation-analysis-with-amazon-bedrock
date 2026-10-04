"""The dashboard and the Lambdas name the same answer engines, the same way.

``web/src/constants/providers.ts`` is the dashboard's provider list (ids,
display names, descriptions, key docs) and ``web/src/hooks/useProviderConfig.ts``
the default model it shows when the providers API is unreachable. The Lambdas
hold the same facts in ``shared.config`` (ids), ``api/manage-providers.py``
(what Settings > AI Providers lists), ``shared.provider_models`` (default
models) and ``search/handler.py`` (the engines an analysis run queries; its
log labels are not display names and are not compared).
An engine added, renamed or re-modelled on one side and not the other fails here.
"""

from __future__ import annotations

import re
from pathlib import Path
from types import ModuleType

from shared.config import LLM_PROVIDERS, Provider
from shared.provider_models import DEFAULT_PROVIDER_MODELS
from testing.handler_fixtures import handler_fixture

_ROOT = Path(__file__).resolve().parents[2]
_WEB_PROVIDERS = _ROOT / 'web' / 'src' / 'constants' / 'providers.ts'
_WEB_PROVIDER_CONFIG = _ROOT / 'web' / 'src' / 'hooks' / 'useProviderConfig.ts'
_SEARCH_HANDLER = _ROOT / 'lambda' / 'search' / 'handler.py'

manage_providers = handler_fixture(
    str(_ROOT / 'lambda' / 'api'),
    'manage-providers.py',
    'provider_contract_manage_providers',
    env={'CORS_ORIGIN_PARAM': '', 'DYNAMODB_TABLE_PROVIDER_CONFIG': 'test-provider-config'},
)


def _web_block(source: str, declaration: str) -> str:
    """The body of the TS object literal ``declaration = { ... }``."""
    match = re.search(re.escape(declaration) + r' = \{\n(.*?)\n\}', source, flags=re.DOTALL)
    assert match is not None, f'{declaration} not found'
    return match.group(1)


def _web_provider_ids() -> dict[str, str]:
    """``PROVIDER`` constant name to provider id, in source order."""
    block = _web_block(_WEB_PROVIDERS.read_text(encoding='utf-8'), 'export const PROVIDER')
    return dict(re.findall(r"^  ([A-Z]+): '([a-z]+)',$", block, flags=re.MULTILINE))


def _web_record(declaration: str) -> dict[str, str]:
    """A ``Record<ProviderId, string>`` of ``providers.ts``, keyed by provider id."""
    ids = _web_provider_ids()
    block = _web_block(_WEB_PROVIDERS.read_text(encoding='utf-8'), f'export const {declaration}: Record<ProviderId, string>')
    return {ids[name]: value for name, value in re.findall(r"^  \[PROVIDER\.([A-Z]+)\]: '([^']+)',$", block, flags=re.MULTILINE)}


def _web_fallback_models() -> dict[str, str]:
    """The default model per provider id the dashboard falls back to."""
    ids = _web_provider_ids()
    source = _WEB_PROVIDER_CONFIG.read_text(encoding='utf-8')
    match = re.search(r'const FALLBACK_PROVIDER_MODELS = \[\n(.*?)\n\] as const;', source, flags=re.DOTALL)
    assert match is not None, 'FALLBACK_PROVIDER_MODELS not found'
    return {ids[name]: model for name, model in re.findall(r"\[PROVIDER\.([A-Z]+), '([^']+)'\]", match.group(1))}


def _run_llm_provider_ids() -> list[str]:
    """The answer engines in the search Lambda's ``PROVIDER_RUNNERS``, in order.

    Read from the source: the handler imports its sibling modules by bare
    name, which only resolve with ``lambda/search`` on ``sys.path``.
    """
    source = _SEARCH_HANDLER.read_text(encoding='utf-8')
    names = re.findall(r"^    \(Provider\.([A-Z]+), '[^']+', '[^']+', ", source, flags=re.MULTILINE)
    return [provider_id for provider_id in (getattr(Provider, name) for name in names) if provider_id in LLM_PROVIDERS]


def _api_llm_providers(module: ModuleType, field: str) -> dict[str, str]:
    """``field`` of every answer engine ``GET /providers`` lists, keyed by id."""
    return {
        provider_id: info[field]
        for provider_id, info in module.PROVIDERS.items()
        if info['type'] == module.PROVIDER_TYPE_LLM
    }


def test_the_dashboard_lists_the_answer_engines_of_the_lambdas_in_order():
    assert list(_web_provider_ids().values()) == list(LLM_PROVIDERS)


def test_an_analysis_run_queries_the_answer_engines_the_dashboard_lists():
    assert _run_llm_provider_ids() == list(_web_provider_ids().values())


def test_settings_names_each_answer_engine_as_the_dashboard_does(manage_providers: ModuleType):
    assert _api_llm_providers(manage_providers, 'name') == _web_record('PROVIDER_NAMES')


def test_settings_describes_each_answer_engine_as_the_dashboard_does(manage_providers: ModuleType):
    assert _api_llm_providers(manage_providers, 'description') == _web_record('PROVIDER_DESCRIPTIONS')


def test_settings_links_each_answer_engine_to_the_key_page_the_dashboard_does(manage_providers: ModuleType):
    assert _api_llm_providers(manage_providers, 'docs_url') == _web_record('PROVIDER_DOCS_URLS')


def test_the_dashboard_falls_back_to_the_default_model_of_each_answer_engine():
    assert _web_fallback_models() == DEFAULT_PROVIDER_MODELS
