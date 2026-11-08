"""Configuration for Lambda functions."""

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from decimal import Decimal
from types import MappingProxyType
from typing import Any


def _integer_env(name: str, default: int, *, minimum: int) -> int:
    """Read and validate an integer environment setting."""
    raw_value = os.environ.get(name)
    if raw_value is None:
        return default

    try:
        value = int(raw_value)
    except ValueError as exc:
        raise ValueError(f'{name} must be an integer') from exc

    if value < minimum:
        raise ValueError(f'{name} must be at least {minimum}')
    return value


# Centralized AI provider constants
# Used for validation, iteration, and provider count calculations
class Provider:
    """AI provider identifiers - single source of truth."""
    # LLM Providers (generate AI responses with citations)
    OPENAI = 'openai'
    PERPLEXITY = 'perplexity'
    GEMINI = 'gemini'
    CLAUDE = 'claude'
    # The AI Overview on a Google results page, read through DataForSEO.
    # An answer engine: its rows count as answers.
    GOOGLE_AI_OVERVIEW = 'google_ai_overview'

    # Search Providers (return search results directly)
    BRAVE = 'brave'
    TAVILY = 'tavily'
    EXA = 'exa'
    SERPAPI = 'serpapi'
    FIRECRAWL = 'firecrawl'
    AGENTCORE = 'agentcore'


# List of LLM providers (for iteration)
LLM_PROVIDERS: list[str] = [
    Provider.OPENAI,
    Provider.PERPLEXITY,
    Provider.GEMINI,
    Provider.CLAUDE,
    Provider.GOOGLE_AI_OVERVIEW,
]

@dataclass(frozen=True)
class ProviderDefinition:
    """What the code, not configuration, fixes about one provider.

    Read-only: no API route, MCP tool or ProviderConfig row changes it. ``GET /providers`` shows it.
    """

    asks_plain_keyword: bool = False
    """Asked the plain keyword once per keyword and run, whatever the personas, and its answer filed under the
    default (unpersonalised) prompt. Changing it would change what past and future answers measure, so it is set
    here only. Each answer row still records the query it was sent (``query``)."""


#: Every provider's definition. Google AI Overviews takes no persona wording: a long persona prompt rarely
#: triggers an overview.
PROVIDER_DEFINITIONS: Mapping[str, ProviderDefinition] = MappingProxyType({
    Provider.OPENAI: ProviderDefinition(),
    Provider.PERPLEXITY: ProviderDefinition(),
    Provider.GEMINI: ProviderDefinition(),
    Provider.CLAUDE: ProviderDefinition(),
    Provider.GOOGLE_AI_OVERVIEW: ProviderDefinition(asks_plain_keyword=True),
    Provider.BRAVE: ProviderDefinition(),
    Provider.TAVILY: ProviderDefinition(),
    Provider.EXA: ProviderDefinition(),
    Provider.SERPAPI: ProviderDefinition(),
    Provider.FIRECRAWL: ProviderDefinition(),
    Provider.AGENTCORE: ProviderDefinition(),
})


def asks_plain_keyword(provider_id: str) -> bool:
    """Whether ``provider_id`` is asked the plain keyword once per keyword and run (an unknown id: no)."""
    definition = PROVIDER_DEFINITIONS.get(provider_id)
    return definition is not None and definition.asks_plain_keyword


#: Answer engines that stay off until an Admin switches them on in Settings (a provider with no config row is
#: otherwise on). Google AI Overviews bills one DataForSEO call per keyword and run, and it shares the DataForSEO
#: login with the SEO pages, so saving that login must not start the spend (TENETS.md, tenet 7: paid is opt-in).
OFF_UNTIL_ENABLED_PROVIDERS: frozenset[str] = frozenset({Provider.GOOGLE_AI_OVERVIEW})


#: The DataForSEO credential's ProviderConfig row, and the attribute on it holding the daily limit of paid
#: DataForSEO calls per user (an Admin sets it in Settings > AI Providers > SEO data; ``shared.seo_spend_limit``).
DATAFORSEO_PROVIDER = 'dataforseo'
SEO_DAILY_CALL_LIMIT_ATTRIBUTE = 'daily_call_limit'
SEO_DAILY_CALL_LIMIT_DEFAULT = 100
#: The highest limit Settings accepts.
SEO_DAILY_CALL_LIMIT_MAX = 100_000


def seo_daily_call_limit(row: Mapping[str, Any] | None) -> int:
    """The limit a ``dataforseo`` ProviderConfig row sets: its value from 0 (paid calls off) up, else the default."""
    value = (row or {}).get(SEO_DAILY_CALL_LIMIT_ATTRIBUTE)
    if isinstance(value, bool) or not isinstance(value, int | Decimal) or value != int(value):
        return SEO_DAILY_CALL_LIMIT_DEFAULT
    return min(max(int(value), 0), SEO_DAILY_CALL_LIMIT_MAX)


def enabled_without_config(provider_id: str) -> bool:
    """Whether ``provider_id`` runs while it has no config row: every provider except the off-until-enabled ones."""
    return provider_id not in OFF_UNTIL_ENABLED_PROVIDERS

# List of search providers (for iteration)
SEARCH_PROVIDERS: list[str] = [
    Provider.BRAVE,
    Provider.TAVILY,
    Provider.EXA,
    Provider.SERPAPI,
    Provider.FIRECRAWL,
    Provider.AGENTCORE,
]

# All providers combined (for backward compatibility)
PROVIDERS: list[str] = LLM_PROVIDERS + SEARCH_PROVIDERS


@dataclass
class LambdaConfig:
    """Configuration settings for Lambda functions."""

    # AWS Configuration
    region: str = os.environ.get("AWS_REGION", "us-west-2")

    # Note: LLM model IDs are resolved via shared.models (ModelRole + ModelTier).
    # Env overrides: BEDROCK_MODEL_<ROLE> or BEDROCK_TIER_<ROLE>.

    # Browser Configuration. The AgentCore session timeout is a service-side
    # backstop, so keep it only slightly above the crawler Lambda's 300 seconds.
    browser_session_timeout: int = field(default_factory=lambda: _integer_env(
        'BROWSER_SESSION_TIMEOUT_SECONDS', 330, minimum=60,
    ))

    # Logical cache freshness; historical DynamoDB rows are retained.
    crawl_freshness_days: int = field(default_factory=lambda: _integer_env(
        'CRAWL_FRESHNESS_DAYS', 30, minimum=0,
    ))
    crawl_blocked_freshness_days: int = field(default_factory=lambda: _integer_env(
        'CRAWL_BLOCKED_FRESHNESS_DAYS', 3, minimum=0,
    ))

    @property
    def crawl_cache_index_name(self) -> str:
        """Return the compact GSI used for crawl freshness decisions."""
        return os.environ.get('CRAWL_CACHE_INDEX_NAME', 'CacheScopeIndex')

    # DynamoDB Table Names (from environment variables)
    @property
    def crawled_content_table(self) -> str:
        return os.environ.get('DYNAMODB_TABLE_CRAWLED_CONTENT', 'CitationAnalysis-CrawledContent')
