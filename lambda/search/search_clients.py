"""
Search provider API clients.
These providers return search results directly (not LLM-generated responses).
"""

import logging
import time
from abc import ABC, abstractmethod
from typing import Any

import requests

from api_clients import clean_url, retry_with_backoff
from shared.serpapi import serpapi_search

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def _elapsed_ms(start_time: float) -> int:
    """Milliseconds elapsed since ``start_time`` (a ``time.time()`` reading)."""
    return int((time.time() - start_time) * 1000)


class BaseSearchClient(ABC):
    """Base class for search provider clients.

    ``search`` is the one flow every provider shares: fetch the provider's
    answer, normalize its hits, and return the standardized result (or the
    standardized error result, with the latency so far). A provider supplies
    the fetch, where its hits live, and what it adds per hit and per answer.
    """

    provider_id: str
    provider_type: str = "search"
    #: Name used in the error log line ("<log_label> error").
    log_label: str
    #: Key of the hit text in each raw hit.
    snippet_key: str
    #: Key of the hit URL in each raw hit.
    url_key: str = "url"

    def __init__(self, api_key: str):
        self.api_key = api_key

    def search(self, query: str) -> dict[str, Any]:
        """Execute the search and return the standardized result."""
        start_time = time.time()
        try:
            raw_response = self._fetch(query)
            latency_ms = _elapsed_ms(start_time)
            citations, results = self._collect_results(self._hits(raw_response))
            return self._build_result(
                citations=citations,
                results=results,
                raw_response=raw_response,
                metadata={
                    "latency_ms": latency_ms,
                    "result_count": len(results),
                    **self._extra_metadata(raw_response),
                },
            )
        except Exception as e:
            logger.exception("%s error", self.log_label)
            return self._build_result(
                citations=[],
                results=[],
                status="error",
                error=str(e),
                metadata={"latency_ms": _elapsed_ms(start_time)}
            )

    @abstractmethod
    def _fetch(self, query: str) -> dict[str, Any]:
        """Ask the provider for ``query`` and return its decoded answer."""

    @abstractmethod
    def _hits(self, raw_response: dict[str, Any]) -> list[dict[str, Any]]:
        """The raw hits in the provider's answer."""

    def _extra_fields(self, item: dict[str, Any]) -> dict[str, Any]:
        """Provider-specific attributes of one hit."""
        return {}

    def _extra_metadata(self, raw_response: dict[str, Any]) -> dict[str, Any]:
        """Provider-specific metadata of one answer."""
        return {}

    def _collect_results(self, items: list[dict[str, Any]]) -> tuple[list[str], list[dict[str, Any]]]:
        """Normalize raw provider hits into ``(citations, search_results)``.

        Hits without a URL are dropped before cleaning (``clean_url('')``
        is ``'://'``, which is truthy), and so are hits whose URL cleans to
        nothing. Each kept
        hit becomes ``{"url", "title", "snippet", *extra_fields, "source"}``,
        where ``extra_fields`` adds the provider-specific attributes and
        ``source`` is this client's ``provider_id``.
        """
        citations: list[str] = []
        results: list[dict[str, Any]] = []
        for item in items:
            raw_url = item.get(self.url_key)
            url = clean_url(raw_url) if isinstance(raw_url, str) and raw_url.strip() else ""
            if not url:
                continue
            citations.append(url)
            result = {
                "url": url,
                "title": item.get("title", ""),
                "snippet": item.get(self.snippet_key, ""),
                **self._extra_fields(item),
                "source": self.provider_id,
            }
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


class _HttpSearchClient(BaseSearchClient):
    """A provider answering one JSON request at ``search_url``, retried with backoff."""

    search_url: str
    #: Request timeout in seconds (also the retry decorator's timeout).
    timeout: int = 30

    def _fetch(self, query: str) -> dict[str, Any]:
        send = retry_with_backoff(provider_name=self.provider_id.upper(), timeout=self.timeout)(self._send)
        return send(self._request_body(query))

    @abstractmethod
    def _request_body(self, query: str) -> dict[str, Any]:
        """The JSON body (or, for a GET, the query parameters) for ``query``."""

    @abstractmethod
    def _headers(self) -> dict[str, str]:
        """The request headers, including the provider's credential."""

    def _send(self, body: dict[str, Any], timeout: int) -> requests.Response:
        """POST ``body`` as JSON to the provider."""
        return requests.post(self.search_url, headers=self._headers(), json=body, timeout=timeout)


class BraveSearchClient(_HttpSearchClient):
    """Brave Search API client."""

    provider_id = "brave"
    log_label = "Brave Search"
    snippet_key = "description"
    search_url = "https://api.search.brave.com/res/v1/web/search"

    def _send(self, body: dict[str, Any], timeout: int) -> requests.Response:
        """Brave searches with a GET and query parameters."""
        return requests.get(self.search_url, headers=self._headers(), params=body, timeout=timeout)

    def _headers(self) -> dict[str, str]:
        return {"Accept": "application/json", "X-Subscription-Token": self.api_key}

    def _request_body(self, query: str) -> dict[str, Any]:
        return {"q": query, "count": 10, "text_decorations": False, "search_lang": "en"}

    def _hits(self, raw_response: dict[str, Any]) -> list[dict[str, Any]]:
        return raw_response.get("web", {}).get("results", [])


class TavilySearchClient(_HttpSearchClient):
    """Tavily Search API client."""

    provider_id = "tavily"
    log_label = "Tavily Search"
    snippet_key = "content"
    search_url = "https://api.tavily.com/search"

    def _headers(self) -> dict[str, str]:
        return {"Content-Type": "application/json"}

    def _request_body(self, query: str) -> dict[str, Any]:
        return {
            "api_key": self.api_key,
            "query": query,
            "search_depth": "basic",
            "include_answer": True,
            "include_raw_content": False,
            "max_results": 10
        }

    def _hits(self, raw_response: dict[str, Any]) -> list[dict[str, Any]]:
        return raw_response.get("results", [])

    def _extra_fields(self, item: dict[str, Any]) -> dict[str, Any]:
        return {"score": item.get("score", 0)}

    def _extra_metadata(self, raw_response: dict[str, Any]) -> dict[str, Any]:
        # Tavily can provide an answer - store it in metadata
        return {"answer": raw_response.get("answer", ""), "response_time": raw_response.get("response_time")}


class ExaSearchClient(_HttpSearchClient):
    """Exa AI Search API client."""

    provider_id = "exa"
    log_label = "Exa Search"
    snippet_key = "text"
    search_url = "https://api.exa.ai/search"
    #: Exa's search type: "neural", "keyword", or "auto".
    search_type = "auto"

    def _headers(self) -> dict[str, str]:
        return {"Content-Type": "application/json", "x-api-key": self.api_key}

    def _request_body(self, query: str) -> dict[str, Any]:
        return {
            "query": query,
            "type": self.search_type,
            "numResults": 10,
            "contents": {
                "text": {"maxCharacters": 500},
                "highlights": True
            }
        }

    def _hits(self, raw_response: dict[str, Any]) -> list[dict[str, Any]]:
        return raw_response.get("results", [])

    def _extra_fields(self, item: dict[str, Any]) -> dict[str, Any]:
        return {
            "published_date": item.get("publishedDate"),
            "author": item.get("author"),
            "highlights": item.get("highlights", []),
        }

    def _extra_metadata(self, raw_response: dict[str, Any]) -> dict[str, Any]:
        return {"search_type": raw_response.get("searchType", self.search_type), "request_id": raw_response.get("requestId")}


class SerpAPIClient(BaseSearchClient):
    """SerpAPI Google Search client (async submit + Search Archive, see ``shared.serpapi``)."""

    provider_id = "serpapi"
    log_label = "SerpAPI"
    snippet_key = "snippet"
    url_key = "link"

    def _fetch(self, query: str) -> dict[str, Any]:
        return serpapi_search(self.api_key, {"q": query, "engine": "google", "num": 10, "hl": "en", "gl": "us"})

    def _hits(self, raw_response: dict[str, Any]) -> list[dict[str, Any]]:
        # Organic results only; the knowledge graph is flagged in metadata
        return raw_response.get("organic_results", [])

    def _extra_fields(self, item: dict[str, Any]) -> dict[str, Any]:
        return {"position": item.get("position"), "displayed_link": item.get("displayed_link")}

    def _extra_metadata(self, raw_response: dict[str, Any]) -> dict[str, Any]:
        return {
            "search_id": raw_response.get("search_metadata", {}).get("id"),
            "has_knowledge_graph": bool(raw_response.get("knowledge_graph", {})),
        }


class FirecrawlSearchClient(_HttpSearchClient):
    """Firecrawl Search API client."""

    provider_id = "firecrawl"
    log_label = "Firecrawl Search"
    snippet_key = "description"
    search_url = "https://api.firecrawl.dev/v1/search"
    timeout = 60

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

    def _request_body(self, query: str) -> dict[str, Any]:
        return {"query": query, "limit": 10}

    def _hits(self, raw_response: dict[str, Any]) -> list[dict[str, Any]]:
        # Data can be an array directly or have a 'web' key
        data = raw_response.get("data", [])
        if isinstance(data, dict):
            return data.get("web", [])
        if isinstance(data, list):
            return data
        return []

    def _extra_fields(self, item: dict[str, Any]) -> dict[str, Any]:
        return {"category": item.get("category")}

    def _extra_metadata(self, raw_response: dict[str, Any]) -> dict[str, Any]:
        return {"job_id": raw_response.get("id"), "credits_used": raw_response.get("creditsUsed")}
