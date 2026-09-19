"""Configuration for Lambda functions."""

import os
from dataclasses import dataclass, field


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

    # Search Providers (return search results directly)
    BRAVE = 'brave'
    TAVILY = 'tavily'
    EXA = 'exa'
    SERPAPI = 'serpapi'
    FIRECRAWL = 'firecrawl'


# List of LLM providers (for iteration)
LLM_PROVIDERS: list[str] = [
    Provider.OPENAI,
    Provider.PERPLEXITY,
    Provider.GEMINI,
    Provider.CLAUDE
]

# List of search providers (for iteration)
SEARCH_PROVIDERS: list[str] = [
    Provider.BRAVE,
    Provider.TAVILY,
    Provider.EXA,
    Provider.SERPAPI,
    Provider.FIRECRAWL
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
