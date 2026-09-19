"""
Search provider API clients.
These providers return search results directly (not LLM-generated responses).
"""

import logging
import time
from abc import ABC, abstractmethod
from collections.abc import Callable
from typing import Any

import requests

from api_clients import clean_url, retry_with_backoff

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def _elapsed_ms(start_time: float) -> int:
    """Milliseconds elapsed since ``start_time`` (a ``time.time()`` reading)."""
    return int((time.time() - start_time) * 1000)


class BaseSearchClient(ABC):
    """Base class for search provider clients."""

    provider_id: str
    provider_type: str = "search"

    @abstractmethod
    def search(self, query: str) -> dict[str, Any]:
        """Execute search and return standardized result."""
        pass

    def _collect_results(
        self,
        items: list[dict[str, Any]],
        *,
        snippet_key: str,
        url_key: str = "url",
        extra_fields: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    ) -> tuple[list[str], list[dict[str, Any]]]:
        """Normalize raw provider hits into ``(citations, search_results)``.

        Hits without a usable URL (after ``clean_url``) are dropped. Each kept
        hit becomes ``{"url", "title", "snippet", *extra_fields, "source"}``,
        where ``extra_fields`` adds the provider-specific attributes and
        ``source`` is this client's ``provider_id``.
        """
        citations: list[str] = []
        results: list[dict[str, Any]] = []
        for item in items:
            url = clean_url(item.get(url_key, ""))
            if not url:
                continue
            citations.append(url)
            result = {
                "url": url,
                "title": item.get("title", ""),
                "snippet": item.get(snippet_key, ""),
            }
            if extra_fields is not None:
                result.update(extra_fields(item))
            result["source"] = self.provider_id
            results.append(result)
        return citations, results

    def _build_result(
        self,
        citations: list[str],
        results: list[dict[str, Any]],
        status: str = "success",
        raw_response: dict | None = None,
        metadata: dict | None = None,
        error: str | None = None
    ) -> dict[str, Any]:
        """Build standardized search result."""
        result = {
            "provider": self.provider_id,
            "provider_type": self.provider_type,
            "response": "",  # Search providers don't generate text responses
            "citations": citations,
            "search_results": results,  # Detailed results with titles, snippets
            "status": status,
            "raw_response": raw_response,
            "metadata": metadata or {}
        }
        if error:
            result["error"] = error
        return result


class BraveSearchClient(BaseSearchClient):
    """Brave Search API client."""

    provider_id = "brave"

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.search.brave.com/res/v1"

    @retry_with_backoff(provider_name="BRAVE", timeout=30)
    def _make_request(self, params: dict, timeout: int = 30) -> requests.Response:
        """Make HTTP request to Brave Search API."""
        headers = {
            "Accept": "application/json",
            "X-Subscription-Token": self.api_key
        }
        return requests.get(
            f"{self.base_url}/web/search",
            headers=headers,
            params=params,
            timeout=timeout
        )

    def search(self, query: str, count: int = 10) -> dict[str, Any]:
        """Execute Brave web search."""
        start_time = time.time()
        try:
            params = {
                "q": query,
                "count": count,
                "text_decorations": False,
                "search_lang": "en"
            }
            raw_response = self._make_request(params)
            latency_ms = _elapsed_ms(start_time)

            web_results = raw_response.get("web", {}).get("results", [])
            citations, results = self._collect_results(web_results, snippet_key="description")

            return self._build_result(
                citations=citations,
                results=results,
                raw_response=raw_response,
                metadata={"latency_ms": latency_ms, "result_count": len(results)}
            )
        except Exception as e:
            logger.exception("Brave Search error")
            return self._build_result(
                citations=[],
                results=[],
                status="error",
                error=str(e),
                metadata={"latency_ms": _elapsed_ms(start_time)}
            )


class TavilySearchClient(BaseSearchClient):
    """Tavily Search API client."""

    provider_id = "tavily"

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.tavily.com"

    @retry_with_backoff(provider_name="TAVILY", timeout=30)
    def _make_request(self, payload: dict, timeout: int = 30) -> requests.Response:
        """Make HTTP request to Tavily API."""
        headers = {"Content-Type": "application/json"}
        return requests.post(
            f"{self.base_url}/search",
            headers=headers,
            json=payload,
            timeout=timeout
        )

    def search(self, query: str, search_depth: str = "basic") -> dict[str, Any]:
        """Execute Tavily search."""
        start_time = time.time()
        try:
            payload = {
                "api_key": self.api_key,
                "query": query,
                "search_depth": search_depth,
                "include_answer": True,
                "include_raw_content": False,
                "max_results": 10
            }
            raw_response = self._make_request(payload)
            latency_ms = _elapsed_ms(start_time)

            citations, results = self._collect_results(
                raw_response.get("results", []),
                snippet_key="content",
                extra_fields=lambda item: {"score": item.get("score", 0)},
            )

            # Tavily can provide an answer - store it in metadata
            answer = raw_response.get("answer", "")

            return self._build_result(
                citations=citations,
                results=results,
                raw_response=raw_response,
                metadata={
                    "latency_ms": latency_ms,
                    "result_count": len(results),
                    "answer": answer,
                    "response_time": raw_response.get("response_time")
                }
            )
        except Exception as e:
            logger.exception("Tavily Search error")
            return self._build_result(
                citations=[],
                results=[],
                status="error",
                error=str(e),
                metadata={"latency_ms": _elapsed_ms(start_time)}
            )


class ExaSearchClient(BaseSearchClient):
    """Exa AI Search API client."""

    provider_id = "exa"

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.exa.ai"

    @retry_with_backoff(provider_name="EXA", timeout=30)
    def _make_request(self, payload: dict, timeout: int = 30) -> requests.Response:
        """Make HTTP request to Exa API."""
        headers = {
            "Content-Type": "application/json",
            "x-api-key": self.api_key
        }
        return requests.post(
            f"{self.base_url}/search",
            headers=headers,
            json=payload,
            timeout=timeout
        )

    def search(self, query: str, search_type: str = "auto", num_results: int = 10) -> dict[str, Any]:
        """Execute Exa neural search."""
        start_time = time.time()
        try:
            payload = {
                "query": query,
                "type": search_type,  # "neural", "keyword", or "auto"
                "numResults": num_results,
                "contents": {
                    "text": {"maxCharacters": 500},
                    "highlights": True
                }
            }
            raw_response = self._make_request(payload)
            latency_ms = _elapsed_ms(start_time)

            citations, results = self._collect_results(
                raw_response.get("results", []),
                snippet_key="text",
                extra_fields=lambda item: {
                    "published_date": item.get("publishedDate"),
                    "author": item.get("author"),
                    "highlights": item.get("highlights", []),
                },
            )

            return self._build_result(
                citations=citations,
                results=results,
                raw_response=raw_response,
                metadata={
                    "latency_ms": latency_ms,
                    "result_count": len(results),
                    "search_type": raw_response.get("searchType", search_type),
                    "request_id": raw_response.get("requestId")
                }
            )
        except Exception as e:
            logger.exception("Exa Search error")
            return self._build_result(
                citations=[],
                results=[],
                status="error",
                error=str(e),
                metadata={"latency_ms": _elapsed_ms(start_time)}
            )


class SerpAPIClient(BaseSearchClient):
    """SerpAPI Google Search client."""

    provider_id = "serpapi"

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://serpapi.com/search"

    @retry_with_backoff(provider_name="SERPAPI", timeout=30)
    def _make_request(self, params: dict, timeout: int = 30) -> requests.Response:
        """Make HTTP request to SerpAPI."""
        return requests.get(
            self.base_url,
            params=params,
            timeout=timeout
        )

    def search(self, query: str, num_results: int = 10) -> dict[str, Any]:
        """Execute Google search via SerpAPI."""
        start_time = time.time()
        try:
            params = {
                "api_key": self.api_key,
                "q": query,
                "engine": "google",
                "num": num_results,
                "hl": "en",
                "gl": "us"
            }
            raw_response = self._make_request(params)
            latency_ms = _elapsed_ms(start_time)

            # Extract organic results
            citations, results = self._collect_results(
                raw_response.get("organic_results", []),
                snippet_key="snippet",
                url_key="link",
                extra_fields=lambda item: {
                    "position": item.get("position"),
                    "displayed_link": item.get("displayed_link"),
                },
            )

            # Also extract knowledge graph if available
            knowledge_graph = raw_response.get("knowledge_graph", {})

            return self._build_result(
                citations=citations,
                results=results,
                raw_response=raw_response,
                metadata={
                    "latency_ms": latency_ms,
                    "result_count": len(results),
                    "search_id": raw_response.get("search_metadata", {}).get("id"),
                    "has_knowledge_graph": bool(knowledge_graph)
                }
            )
        except Exception as e:
            logger.exception("SerpAPI error")
            return self._build_result(
                citations=[],
                results=[],
                status="error",
                error=str(e),
                metadata={"latency_ms": _elapsed_ms(start_time)}
            )


class FirecrawlSearchClient(BaseSearchClient):
    """Firecrawl Search API client."""

    provider_id = "firecrawl"

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.firecrawl.dev/v1"

    @retry_with_backoff(provider_name="FIRECRAWL", timeout=60)
    def _make_request(self, payload: dict, timeout: int = 60) -> requests.Response:
        """Make HTTP request to Firecrawl API."""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        return requests.post(
            f"{self.base_url}/search",
            headers=headers,
            json=payload,
            timeout=timeout
        )

    def search(self, query: str, limit: int = 10) -> dict[str, Any]:
        """Execute Firecrawl search."""
        start_time = time.time()
        try:
            payload = {
                "query": query,
                "limit": limit
            }

            raw_response = self._make_request(payload)
            latency_ms = _elapsed_ms(start_time)

            # Extract results - data can be an array directly or have a 'web' key
            data = raw_response.get("data", [])
            if isinstance(data, dict):
                # If data is a dict, look for 'web' array
                web_results = data.get("web", [])
            elif isinstance(data, list):
                # If data is already an array, use it directly
                web_results = data
            else:
                web_results = []

            citations, results = self._collect_results(
                web_results,
                snippet_key="description",
                extra_fields=lambda item: {"category": item.get("category")},
            )

            return self._build_result(
                citations=citations,
                results=results,
                raw_response=raw_response,
                metadata={
                    "latency_ms": latency_ms,
                    "result_count": len(results),
                    "job_id": raw_response.get("id"),
                    "credits_used": raw_response.get("creditsUsed")
                }
            )
        except Exception as e:
            logger.exception("Firecrawl Search error")
            return self._build_result(
                citations=[],
                results=[],
                status="error",
                error=str(e),
                metadata={"latency_ms": _elapsed_ms(start_time)}
            )
