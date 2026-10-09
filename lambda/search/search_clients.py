"""
Search provider API clients.
These providers return search results directly (not LLM-generated responses).
"""

import logging
import time
from abc import ABC, abstractmethod
from collections.abc import Mapping
from copy import copy
from types import MappingProxyType
from typing import Any, ClassVar

import requests

from api_clients import clean_url, retry_with_backoff
from shared.markets import Market, brave_params, exa_params, firecrawl_params, serpapi_params, tavily_params
from shared.serpapi import serpapi_search

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

#: Output field -> (source key, default when the key is missing).
FieldTable = Mapping[str, tuple[str, Any]]


def _elapsed_ms(start_time: float) -> int:
    """Milliseconds elapsed since ``start_time`` (a ``time.time()`` reading)."""
    return int((time.time() - start_time) * 1000)


def _copy_fields(source: Mapping[str, Any], table: FieldTable) -> dict[str, Any]:
    """``{field: source.get(key, default)}`` for every row of ``table``."""
    return {field: source.get(key, copy(default)) for field, (key, default) in table.items()}


def _fields(**rows: tuple[str, Any]) -> FieldTable:
    """A read-only ``FieldTable``; a mutable default is copied per use, never shared."""
    return MappingProxyType(rows)


class BaseSearchClient(ABC):
    """Base class for search provider clients.

    ``search`` is the one flow every provider shares: fetch the provider's
    answer, normalize its hits, and return the standardized result (or the
    standardized error result, with the latency so far). A provider supplies
    the fetch and describes its answer with the class attributes below.
    """

    provider_id: str
    provider_type: str = "search"
    #: Name used in the error log line ("<log_label> error").
    log_label: str
    #: Key of the hit list in the provider's answer.
    hits_key: str = "results"
    #: Key of the hit text in each raw hit.
    snippet_key: str
    #: Key of the hit URL in each raw hit.
    url_key: str = "url"
    #: Provider-specific attributes copied from each hit into its search result.
    hit_fields: ClassVar[FieldTable] = _fields()
    #: Provider-specific attributes copied from the answer into the metadata.
    answer_fields: ClassVar[FieldTable] = _fields()

    def __init__(self, api_key: str):
        self.api_key = api_key

    def search(self, query: str, market: Market | None = None) -> dict[str, Any]:
        """Execute the search and return the standardized result.

        ``market`` adds the provider's native country/language parameters;
        without one the request is exactly what it was before markets.
        """
        start_time = time.time()
        try:
            raw_response = self._fetch(query, market)
            latency_ms = _elapsed_ms(start_time)
            citations, results = self._collect_results(self._hits(raw_response))
            return self._build_result(
                citations=citations,
                results=results,
                raw_response=raw_response,
                metadata={
                    "latency_ms": latency_ms,
                    "result_count": len(results),
                    **self._answer_metadata(raw_response),
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
    def _fetch(self, query: str, market: Market | None) -> dict[str, Any]:
        """Ask the provider for ``query`` (from ``market``) and return its decoded answer."""

    def _hits(self, raw_response: dict[str, Any]) -> list[dict[str, Any]]:
        """The raw hits in the provider's answer."""
        return raw_response.get(self.hits_key, [])

    def _answer_metadata(self, raw_response: dict[str, Any]) -> dict[str, Any]:
        """Provider-specific metadata of one answer."""
        return _copy_fields(raw_response, self.answer_fields)

    def _collect_results(self, items: list[dict[str, Any]]) -> tuple[list[str], list[dict[str, Any]]]:
        """Normalize raw provider hits into ``(citations, search_results)``.

        Hits without a URL are dropped before cleaning (``clean_url('')``
        is ``'://'``, which is truthy), and so are hits whose URL cleans to
        nothing. Each kept
        hit becomes ``{"url", "title", "snippet", *hit_fields, "source"}``,
        where ``hit_fields`` adds the provider-specific attributes and
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
                **_copy_fields(item, self.hit_fields),
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
    #: Headers sent with every request.
    base_headers: ClassVar[Mapping[str, str]] = MappingProxyType({"Content-Type": "application/json"})
    #: ``(header, template)`` carrying the API key (``{key}`` in the template), or ``None`` when it travels in the body.
    credential_header: ClassVar[tuple[str, str] | None] = None

    def _fetch(self, query: str, market: Market | None) -> dict[str, Any]:
        send = retry_with_backoff(provider_name=self.provider_id.upper(), timeout=self.timeout)(self._send)
        return send({**self._request_body(query), **(self._market_params(market) if market else {})})

    @abstractmethod
    def _request_body(self, query: str) -> dict[str, Any]:
        """The JSON body (or, for a GET, the query parameters) for ``query``, as asked without a market."""

    @abstractmethod
    def _market_params(self, market: Market) -> dict[str, Any]:
        """The provider's native locale parameters for ``market``, merged over the request body."""

    def _headers(self) -> dict[str, str]:
        """The request headers, including the provider's credential."""
        headers = dict(self.base_headers)
        if self.credential_header is not None:
            name, template = self.credential_header
            headers[name] = template.format(key=self.api_key)
        return headers

    def _send(self, body: dict[str, Any], timeout: int) -> requests.Response:
        """POST ``body`` as JSON to the provider."""
        return requests.post(self.search_url, headers=self._headers(), json=body, timeout=timeout)


class BraveSearchClient(_HttpSearchClient):
    """Brave Search API client."""

    provider_id = "brave"
    log_label = "Brave Search"
    snippet_key = "description"
    search_url = "https://api.search.brave.com/res/v1/web/search"
    base_headers = MappingProxyType({"Accept": "application/json"})
    credential_header = ("X-Subscription-Token", "{key}")

    def _send(self, body: dict[str, Any], timeout: int) -> requests.Response:
        """Brave searches with a GET and query parameters."""
        return requests.get(self.search_url, headers=self._headers(), params=body, timeout=timeout)

    def _request_body(self, query: str) -> dict[str, Any]:
        return {"q": query, "count": 10, "text_decorations": False, "search_lang": "en"}

    def _market_params(self, market: Market) -> dict[str, Any]:
        return brave_params(market)

    def _hits(self, raw_response: dict[str, Any]) -> list[dict[str, Any]]:
        return raw_response.get("web", {}).get("results", [])


class TavilySearchClient(_HttpSearchClient):
    """Tavily Search API client (the API key travels in the body)."""

    provider_id = "tavily"
    log_label = "Tavily Search"
    snippet_key = "content"
    search_url = "https://api.tavily.com/search"
    hit_fields = _fields(score=("score", 0))
    # Tavily can provide an answer - store it in metadata
    answer_fields = _fields(answer=("answer", ""), response_time=("response_time", None))

    def _request_body(self, query: str) -> dict[str, Any]:
        return {
            "api_key": self.api_key,
            "query": query,
            "search_depth": "basic",
            "include_answer": True,
            "include_raw_content": False,
            "max_results": 10
        }

    def _market_params(self, market: Market) -> dict[str, Any]:
        return tavily_params(market)


class ExaSearchClient(_HttpSearchClient):
    """Exa AI Search API client."""

    provider_id = "exa"
    log_label = "Exa Search"
    snippet_key = "text"
    search_url = "https://api.exa.ai/search"
    credential_header = ("x-api-key", "{key}")
    #: Exa's search type: "neural", "keyword", or "auto".
    search_type = "auto"
    hit_fields = _fields(
        published_date=("publishedDate", None),
        author=("author", None),
        highlights=("highlights", []),
    )
    answer_fields = _fields(search_type=("searchType", search_type), request_id=("requestId", None))

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

    def _market_params(self, market: Market) -> dict[str, Any]:
        return exa_params(market)


class SerpAPIClient(BaseSearchClient):
    """SerpAPI Google Search client (async submit + Search Archive, see ``shared.serpapi``)."""

    provider_id = "serpapi"
    log_label = "SerpAPI"
    # Organic results only; the knowledge graph is flagged in metadata
    hits_key = "organic_results"
    snippet_key = "snippet"
    url_key = "link"
    hit_fields = _fields(position=("position", None), displayed_link=("displayed_link", None))

    def _fetch(self, query: str, market: Market | None) -> dict[str, Any]:
        locale = serpapi_params(market) if market else {"hl": "en", "gl": "us"}
        return serpapi_search(self.api_key, {"q": query, "engine": "google", "num": 10, **locale})

    def _answer_metadata(self, raw_response: dict[str, Any]) -> dict[str, Any]:
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
    credential_header = ("Authorization", "Bearer {key}")
    hit_fields = _fields(category=("category", None))
    answer_fields = _fields(job_id=("id", None), credits_used=("creditsUsed", None))

    def _request_body(self, query: str) -> dict[str, Any]:
        return {"query": query, "limit": 10}

    def _market_params(self, market: Market) -> dict[str, Any]:
        return firecrawl_params(market)

    def _hits(self, raw_response: dict[str, Any]) -> list[dict[str, Any]]:
        # Data can be an array directly or have a 'web' key
        data = raw_response.get("data", [])
        if isinstance(data, dict):
            return data.get("web", [])
        if isinstance(data, list):
            return data
        return []
