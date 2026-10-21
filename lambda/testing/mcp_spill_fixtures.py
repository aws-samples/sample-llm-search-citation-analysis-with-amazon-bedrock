"""A fake S3 for the MCP server's spill-pointer tests: what a presigned GET answers, and what it was asked.

``invoke.fetch_spilled_body`` opens a ``requests.Session`` (``invoke.spill_session``)
and streams one GET; ``FakeSpillSession`` stands in for both, so no test opens a
socket.
"""

from __future__ import annotations

import json
from typing import Any

SPILL_URL = ('https://citation-analysis-keywords-000000000000.s3.amazonaws.com/api-responses/abc.json'
             '?X-Amz-Signature=secret-signature')


def spill_pointer(url: str = SPILL_URL, size_bytes: int = 5_400_000) -> dict[str, Any]:
    """The body a router answers in place of one over the spill threshold (``shared.response_spill``)."""
    return {'spilled_response': {'url': url, 'size_bytes': size_bytes, 'expires_in': 300}}


class FakeSpillResponse:
    """A streamed ``requests.Response``: status, headers and the body in chunks."""

    def __init__(self, status_code: int, chunks: list[bytes], headers: dict[str, str]) -> None:
        self.status_code = status_code
        self.headers = headers
        self._chunks = chunks
        self.chunks_read = 0

    def iter_content(self, chunk_size: int) -> Any:
        for chunk in self._chunks:
            self.chunks_read += 1
            yield chunk

    def __enter__(self) -> FakeSpillResponse:
        return self

    def __exit__(self, *_exc: object) -> None:
        return None


class FakeSpillSession:
    """``requests.Session`` serving one answer to every GET and recording each request."""

    def __init__(self) -> None:
        self.trust_env = True
        self.requests: list[tuple[str, dict[str, Any]]] = []
        self.failure: Exception | None = None
        self.serve(200, {})

    def serve(self, status: int, body: Any, *, chunk_bytes: int = 1024, headers: dict[str, str] | None = None) -> None:
        """Answer ``status`` with the JSON of ``body`` (or ``body`` itself when it is bytes), in chunks."""
        raw = body if isinstance(body, bytes) else json.dumps(body).encode('utf-8')
        self._answer = (status, [raw[start:start + chunk_bytes] for start in range(0, len(raw), chunk_bytes)],
                        {'Content-Length': str(len(raw))} if headers is None else headers)

    def get(self, url: str, **kwargs: Any) -> FakeSpillResponse:
        self.requests.append((url, kwargs))
        if self.failure is not None:
            raise self.failure
        status, chunks, headers = self._answer
        self.last_response = FakeSpillResponse(status, chunks, headers)
        return self.last_response

    def __enter__(self) -> FakeSpillSession:
        return self

    def __exit__(self, *_exc: object) -> None:
        return None
