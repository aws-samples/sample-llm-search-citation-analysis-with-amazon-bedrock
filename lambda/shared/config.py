"""Configuration for Lambda functions."""

import os
import boto3
from dataclasses import dataclass
from typing import Optional, List

# Provider type constants
class ProviderType:
    """Provider type identifiers."""
    LLM = 'llm'
    SEARCH = 'search'

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
LLM_PROVIDERS: List[str] = [
    Provider.OPENAI, 
    Provider.PERPLEXITY, 
    Provider.GEMINI, 
    Provider.CLAUDE
]

# List of search providers (for iteration)
SEARCH_PROVIDERS: List[str] = [
    Provider.BRAVE,
    Provider.TAVILY,
    Provider.EXA,
    Provider.SERPAPI,
    Provider.FIRECRAWL
]

# All providers combined (for backward compatibility)
PROVIDERS: List[str] = LLM_PROVIDERS + SEARCH_PROVIDERS

# Provider type mapping
PROVIDER_TYPES = {
    # LLM providers
    Provider.OPENAI: ProviderType.LLM,
    Provider.PERPLEXITY: ProviderType.LLM,
    Provider.GEMINI: ProviderType.LLM,
    Provider.CLAUDE: ProviderType.LLM,
    # Search providers
    Provider.BRAVE: ProviderType.SEARCH,
    Provider.TAVILY: ProviderType.SEARCH,
    Provider.EXA: ProviderType.SEARCH,
    Provider.SERPAPI: ProviderType.SEARCH,
    Provider.FIRECRAWL: ProviderType.SEARCH,
}


@dataclass
class LambdaConfig:
    """Configuration settings for Lambda functions."""
    
    # AWS Configuration
    region: str = os.environ.get("AWS_REGION", "us-west-2")
    
    # LLM Model for summarization
    llm_model_id: str = "global.anthropic.claude-sonnet-4-5-20250929-v1:0"
    
    # Get AWS Account ID automatically
    @property
    def aws_account_id(self) -> str:
        if not hasattr(self, '_account_id'):
            try:
                sts = boto3.client('sts')
                self._account_id = sts.get_caller_identity()['Account']
            except Exception:
                self._account_id = os.environ.get('AWS_ACCOUNT_ID', 'unknown')
        return self._account_id
    
    # Browser Configuration
    browser_timeout: int = 60000  # 60 seconds
    browser_session_timeout: int = 3600  # 1 hour
    
    # DynamoDB Table Names (from environment variables)
    @property
    def search_results_table(self) -> str:
        return os.environ.get('SEARCH_RESULTS_TABLE', 'CitationAnalysis-SearchResults')
    
    @property
    def citations_table(self) -> str:
        return os.environ.get('CITATIONS_TABLE', 'CitationAnalysis-Citations')
    
    @property
    def crawled_content_table(self) -> str:
        return os.environ.get('CRAWLED_CONTENT_TABLE', 'CitationAnalysis-CrawledContent')
    
    # Secrets Manager prefix
    secrets_prefix: str = "citation-analysis/"
