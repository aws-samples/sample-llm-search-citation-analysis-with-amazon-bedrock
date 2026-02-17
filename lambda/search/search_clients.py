"""
Search provider API clients.
These providers return search results directly (not LLM-generated responses).
"""

import requests
import time
import logging
from typing import Dict, List, Any, Optional
from abc import ABC, abstractmethod

from api_clients import retry_with_backoff, clean_url

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


class BaseSearchClient(ABC):
    """Base class for search provider clients."""
    
    provider_id: str
    provider_type: str = "search"
    
    @abstractmethod
    def search(self, query: str) -> Dict[str, Any]:
        """Execute search and return standardized result."""
        pass
    
    def _build_result(
        self,
        citations: List[str],
        results: List[Dict[str, Any]],
        status: str = "success",
        raw_response: Optional[Dict] = None,
        metadata: Optional[Dict] = None,
        error: Optional[str] = None
    ) -> Dict[str, Any]:
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
    def _make_request(self, params: Dict, timeout: int = 30) -> requests.Response:
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
    
    def search(self, query: str, count: int = 10) -> Dict[str, Any]:
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
            latency_ms = int((time.time() - start_time) * 1000)
            
            citations = []
            results = []
            
            web_results = raw_response.get("web", {}).get("results", [])
            for item in web_results:
                url = clean_url(item.get("url", ""))
                if url:
                    citations.append(url)
                    results.append({
                        "url": url,
                        "title": item.get("title", ""),
                        "snippet": item.get("description", ""),
                        "source": "brave"
                    })
            
            return self._build_result(
                citations=citations,
                results=results,
                raw_response=raw_response,
                metadata={"latency_ms": latency_ms, "result_count": len(results)}
            )
        except Exception as e:
            logger.error(f"Brave Search error: {str(e)}")
            return self._build_result(
                citations=[],
                results=[],
                status="error",
                error=str(e),
                metadata={"latency_ms": int((time.time() - start_time) * 1000)}
            )


class TavilySearchClient(BaseSearchClient):
    """Tavily Search API client."""
    
    provider_id = "tavily"
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.tavily.com"
    
    @retry_with_backoff(provider_name="TAVILY", timeout=30)
    def _make_request(self, payload: Dict, timeout: int = 30) -> requests.Response:
        """Make HTTP request to Tavily API."""
        headers = {"Content-Type": "application/json"}
        return requests.post(
            f"{self.base_url}/search",
            headers=headers,
            json=payload,
            timeout=timeout
        )
    
    def search(self, query: str, search_depth: str = "basic") -> Dict[str, Any]:
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
            latency_ms = int((time.time() - start_time) * 1000)
            
            citations = []
            results = []
            
            for item in raw_response.get("results", []):
                url = clean_url(item.get("url", ""))
                if url:
                    citations.append(url)
                    results.append({
                        "url": url,
                        "title": item.get("title", ""),
                        "snippet": item.get("content", ""),
                        "score": item.get("score", 0),
                        "source": "tavily"
                    })
            
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
            logger.error(f"Tavily Search error: {str(e)}")
            return self._build_result(
                citations=[],
                results=[],
                status="error",
                error=str(e),
                metadata={"latency_ms": int((time.time() - start_time) * 1000)}
            )


class ExaSearchClient(BaseSearchClient):
    """Exa AI Search API client."""
    
    provider_id = "exa"
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.exa.ai"
    
    @retry_with_backoff(provider_name="EXA", timeout=30)
    def _make_request(self, payload: Dict, timeout: int = 30) -> requests.Response:
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
    
    def search(self, query: str, search_type: str = "auto", num_results: int = 10) -> Dict[str, Any]:
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
            latency_ms = int((time.time() - start_time) * 1000)
            
            citations = []
            results = []
            
            for item in raw_response.get("results", []):
                url = clean_url(item.get("url", ""))
                if url:
                    citations.append(url)
                    results.append({
                        "url": url,
                        "title": item.get("title", ""),
                        "snippet": item.get("text", ""),
                        "published_date": item.get("publishedDate"),
                        "author": item.get("author"),
                        "highlights": item.get("highlights", []),
                        "source": "exa"
                    })
            
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
            logger.error(f"Exa Search error: {str(e)}")
            return self._build_result(
                citations=[],
                results=[],
                status="error",
                error=str(e),
                metadata={"latency_ms": int((time.time() - start_time) * 1000)}
            )


class SerpAPIClient(BaseSearchClient):
    """SerpAPI Google Search client."""
    
    provider_id = "serpapi"
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://serpapi.com/search"
    
    @retry_with_backoff(provider_name="SERPAPI", timeout=30)
    def _make_request(self, params: Dict, timeout: int = 30) -> requests.Response:
        """Make HTTP request to SerpAPI."""
        return requests.get(
            self.base_url,
            params=params,
            timeout=timeout
        )
    
    def search(self, query: str, num_results: int = 10) -> Dict[str, Any]:
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
            latency_ms = int((time.time() - start_time) * 1000)
            
            citations = []
            results = []
            
            # Extract organic results
            for item in raw_response.get("organic_results", []):
                url = clean_url(item.get("link", ""))
                if url:
                    citations.append(url)
                    results.append({
                        "url": url,
                        "title": item.get("title", ""),
                        "snippet": item.get("snippet", ""),
                        "position": item.get("position"),
                        "displayed_link": item.get("displayed_link"),
                        "source": "serpapi"
                    })
            
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
            logger.error(f"SerpAPI error: {str(e)}")
            return self._build_result(
                citations=[],
                results=[],
                status="error",
                error=str(e),
                metadata={"latency_ms": int((time.time() - start_time) * 1000)}
            )


class FirecrawlSearchClient(BaseSearchClient):
    """Firecrawl Search API client."""
    
    provider_id = "firecrawl"
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.firecrawl.dev/v1"
    
    @retry_with_backoff(provider_name="FIRECRAWL", timeout=60)
    def _make_request(self, payload: Dict, timeout: int = 60) -> requests.Response:
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
    
    def search(self, query: str, limit: int = 10, scrape: bool = False) -> Dict[str, Any]:
        """Execute Firecrawl search with optional scraping."""
        start_time = time.time()
        try:
            payload = {
                "query": query,
                "limit": limit
            }
            
            # Optionally include scrape options for markdown content
            if scrape:
                payload["scrapeOptions"] = {
                    "formats": [{"type": "markdown"}]
                }
            
            raw_response = self._make_request(payload)
            latency_ms = int((time.time() - start_time) * 1000)
            
            citations = []
            results = []
            
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
            
            for item in web_results:
                url = clean_url(item.get("url", ""))
                if url:
                    citations.append(url)
                    results.append({
                        "url": url,
                        "title": item.get("title", ""),
                        "snippet": item.get("description", ""),
                        "markdown": item.get("markdown"),  # If scraping enabled
                        "category": item.get("category"),
                        "source": "firecrawl"
                    })
            
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
            logger.error(f"Firecrawl Search error: {str(e)}")
            return self._build_result(
                citations=[],
                results=[],
                status="error",
                error=str(e),
                metadata={"latency_ms": int((time.time() - start_time) * 1000)}
            )


# Registry of all search clients
SEARCH_CLIENT_REGISTRY = {
    "brave": BraveSearchClient,
    "tavily": TavilySearchClient,
    "exa": ExaSearchClient,
    "serpapi": SerpAPIClient,
    "firecrawl": FirecrawlSearchClient,
}
