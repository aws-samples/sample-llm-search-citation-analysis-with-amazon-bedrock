"""
YouTube oEmbed: the title, channel and thumbnail of a cited video, without a browser.

The crawler reads a cited YouTube video through
``https://www.youtube.com/oembed?url=<canonical watch URL>&format=json`` instead
of an AgentCore browser session: the watch page is a script-rendered player
with a consent wall, so a browser capture costs a paid session and yields
nothing useful, while oEmbed answers a small JSON document::

    {"title": "...", "author_name": "Rick Astley",
     "author_url": "https://www.youtube.com/@RickAstleyYT",
     "thumbnail_url": "https://i.ytimg.com/vi/<id>/hqdefault.jpg", ...}

The request goes through ``shared.safe_fetch`` pinned to ``www.youtube.com``:
no redirect is followed (``max_hops=0``), the body is read up to
``MAX_OEMBED_BYTES`` and every hop is bounded by ``OEMBED_TIMEOUT_SECONDS``.
YouTube answers 401 for a video that may not be embedded, 403 when embedding
is disabled and 404 for a removed or private video; each is a
``VideoMetadataError`` the crawler stores as an error crawl.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode, urlsplit

from shared.safe_fetch import fetch_following_validated_redirects, host_matches
from shared.youtube import YOUTUBE_VIDEO_ID, canonical_youtube_url_for_id

logger = logging.getLogger(__name__)

OEMBED_ENDPOINT = 'https://www.youtube.com/oembed'
OEMBED_TIMEOUT_SECONDS = 10
# A real answer is about 1 KB (the embed `html` dominates it).
MAX_OEMBED_BYTES = 64 * 1024
# Longest title / channel name / link kept; YouTube titles stop at 100 characters.
MAX_TEXT_LENGTH = 500

_OEMBED_HOSTS = frozenset({'www.youtube.com'})
_VIDEO_ID = re.compile(YOUTUBE_VIDEO_ID)
_STATUS_ERRORS = {
    401: 'YouTube does not allow this video to be embedded (HTTP 401)',
    403: 'YouTube refused the video details: embedding is disabled (HTTP 403)',
    404: 'YouTube video not found: removed or private (HTTP 404)',
}

Fetcher = Callable[..., tuple[Any | None, str | None, str]]


class VideoMetadataError(Exception):
    """The video details could not be read; the message is stored as the crawl error."""


@dataclass(frozen=True)
class VideoMetadata:
    """What oEmbed says about one video. Links are https or empty."""

    title: str
    author_name: str
    author_url: str
    thumbnail_url: str

    def summary(self) -> str:
        """One sentence naming the video and its channel."""
        if self.author_name:
            return f'YouTube video "{self.title}" by {self.author_name}.'
        return f'YouTube video "{self.title}".'

    def content(self, url: str) -> str:
        """The plain-text record stored as the crawl's content."""
        lines = [self.title, f'Channel: {self.author_name}' if self.author_name else '', self.author_url, url]
        return '\n'.join(line for line in lines if line)


def oembed_request_url(video_id: str) -> str:
    """The oEmbed request for ``video_id``."""
    query = urlencode({'url': canonical_youtube_url_for_id(video_id), 'format': 'json'})
    return f'{OEMBED_ENDPOINT}?{query}'


def _text(document: dict[str, Any], key: str) -> str:
    value = document.get(key)
    return value.strip()[:MAX_TEXT_LENGTH] if isinstance(value, str) else ''


def _https_link(document: dict[str, Any], key: str) -> str:
    """The link under ``key`` when it is an https URL with a host and fits, else ``''``."""
    link = _text(document, key)
    try:
        parts = urlsplit(link)
    except ValueError:
        return ''
    if parts.scheme != 'https' or not parts.hostname or len(link) >= MAX_TEXT_LENGTH:
        return ''
    return link


def _read_body(response: Any) -> bytes:
    """At most ``MAX_OEMBED_BYTES`` of the body; a larger one is refused."""
    declared = response.headers.get('Content-Length')
    if isinstance(declared, str) and declared.isdigit() and int(declared) > MAX_OEMBED_BYTES:
        raise VideoMetadataError('YouTube video details are too large')
    try:
        body = response.raw.read(MAX_OEMBED_BYTES + 1, decode_content=True)
    except Exception as error:
        logger.exception('Could not read the oEmbed body')
        raise VideoMetadataError('Could not read the YouTube video details') from error
    if not isinstance(body, bytes):
        raise VideoMetadataError('Could not read the YouTube video details')
    if len(body) > MAX_OEMBED_BYTES:
        raise VideoMetadataError('YouTube video details are too large')
    return body


def _parse_metadata(body: bytes) -> VideoMetadata:
    try:
        document = json.loads(body)
    except ValueError as error:
        raise VideoMetadataError('YouTube returned unreadable video details') from error
    if not isinstance(document, dict):
        raise VideoMetadataError('YouTube returned unreadable video details')
    title = _text(document, 'title')
    if not title:
        raise VideoMetadataError('YouTube returned video details without a title')
    return VideoMetadata(
        title=title,
        author_name=_text(document, 'author_name'),
        author_url=_https_link(document, 'author_url'),
        thumbnail_url=_https_link(document, 'thumbnail_url'),
    )


def _checked_response(response: Any, final_url: str | None) -> Any:
    """The response when it is a 200 from the pinned host; otherwise ``VideoMetadataError``."""
    if final_url is None or not host_matches(final_url, _OEMBED_HOSTS):
        raise VideoMetadataError('YouTube video details came from an unexpected host')
    status = response.status_code
    if status != 200:
        raise VideoMetadataError(_STATUS_ERRORS.get(status, f'YouTube video details unavailable (HTTP {status})'))
    return response


def fetch_video_metadata(video_id: str, *, fetcher: Fetcher = fetch_following_validated_redirects) -> VideoMetadata:
    """Read the oEmbed details of ``video_id``; ``VideoMetadataError`` when they cannot be read."""
    if not _VIDEO_ID.fullmatch(video_id):
        raise VideoMetadataError('Not a YouTube video id')
    response, final_url, error = fetcher(
        oembed_request_url(video_id),
        timeout=OEMBED_TIMEOUT_SECONDS,
        max_hops=0,
        stream=True,
        headers={'Accept': 'application/json'},
    )
    if response is None:
        # `error` is safe_fetch's generic reason; a redirect (refused: no hop
        # is followed) reads `Too many redirects`.
        raise VideoMetadataError(f'Could not fetch the YouTube video details ({error or "no response"})')
    try:
        body = _read_body(_checked_response(response, final_url))
    finally:
        response.close()
    return _parse_metadata(body)


__all__ = [
    'MAX_OEMBED_BYTES',
    'OEMBED_TIMEOUT_SECONDS',
    'VideoMetadata',
    'VideoMetadataError',
    'fetch_video_metadata',
    'oembed_request_url',
]
