"""
YouTube video links: one canonical URL per video, and the content type of a citation.

AI engines cite the same video as ``youtu.be/ID``, ``m.youtube.com/watch?v=ID&t=42``,
``/shorts/ID``, an embed player link and so on. Deduplication keys citations by
``shared.utils.normalize_url``, which returns ``canonical_youtube_url`` for every
one of these shapes, so one video is one Citations row whatever link was cited.

Recognised shapes (http or https, no credentials, no explicit port):

- ``youtube.com``, ``www.youtube.com``, ``m.youtube.com``: ``/watch?v=ID`` (any
  other query parameter, e.g. ``t``, ``si``, ``list``, is dropped) and
  ``/shorts/ID``, ``/embed/ID``, ``/live/ID``
- ``youtu.be/ID``
- ``youtube-nocookie.com`` / ``www.youtube-nocookie.com``: ``/embed/ID``

A trailing slash after the id is accepted. ``test-fixtures/youtube-urls.json``
pins the cases. Anything else (a channel, a playlist, a search page) is a page.

This module has no dependencies so ``shared.utils`` can import it on every cold start.
"""

from __future__ import annotations

import re
from typing import Literal
from urllib.parse import SplitResult, parse_qsl, urlsplit

# The 11-character video id; also the id shape `manage-custom-reports` accepts for video blocks.
YOUTUBE_VIDEO_ID = r'[A-Za-z0-9_-]{11}'

ContentType = Literal['video', 'page']
CONTENT_TYPES: tuple[ContentType, ...] = ('video', 'page')

_VIDEO_ID = re.compile(YOUTUBE_VIDEO_ID)
_WATCH_HOSTS = frozenset({'youtube.com', 'www.youtube.com', 'm.youtube.com'})
_WATCH_PATHS = frozenset({'/watch', '/watch/'})
_PLAYER_PATH = re.compile(rf'/(?:shorts|embed|live)/({YOUTUBE_VIDEO_ID})/?')
_NOCOOKIE_PATH = re.compile(rf'/embed/({YOUTUBE_VIDEO_ID})/?')
# Host -> the path shape that carries the id (in group 1).
_ID_PATHS: dict[str, re.Pattern[str]] = {
    **dict.fromkeys(_WATCH_HOSTS, _PLAYER_PATH),
    'youtu.be': re.compile(rf'/({YOUTUBE_VIDEO_ID})/?'),
    'youtube-nocookie.com': _NOCOOKIE_PATH,
    'www.youtube-nocookie.com': _NOCOOKIE_PATH,
}


def _split_http_url(url: object) -> SplitResult | None:
    """The parts of an http(s) URL without credentials or an explicit port; ``None`` otherwise."""
    if not isinstance(url, str):
        return None
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return None
    if parts.scheme.lower() not in ('http', 'https'):
        return None
    host = parts.hostname or ''
    # `hostname` is lowercased and drops userinfo and port; a netloc that
    # differs from it carries one of them (or an empty port, `youtu.be:`).
    if not host or parts.netloc.lower() != host:
        return None
    return parts


def _watch_id(query: str) -> str | None:
    """The first non-blank ``v`` value when it is a video id (``parse_qsl`` drops blank values)."""
    value = next((value for key, value in parse_qsl(query) if key == 'v'), '')
    return value if _VIDEO_ID.fullmatch(value) else None


def youtube_video_id(url: object) -> str | None:
    """The video id of a YouTube video link, ``None`` for anything else."""
    parts = _split_http_url(url)
    if parts is None:
        return None
    host = parts.netloc.lower()
    if host in _WATCH_HOSTS and parts.path in _WATCH_PATHS:
        return _watch_id(parts.query)
    path = _ID_PATHS.get(host)
    match = path.fullmatch(parts.path) if path is not None else None
    return match.group(1) if match else None


def canonical_youtube_url_for_id(video_id: str) -> str:
    """The canonical watch URL of ``video_id`` (assumed valid)."""
    return f'https://www.youtube.com/watch?v={video_id}'


def canonical_youtube_url(url: object) -> str | None:
    """``https://www.youtube.com/watch?v=ID`` for a YouTube video link, ``None`` for anything else."""
    video_id = youtube_video_id(url)
    return canonical_youtube_url_for_id(video_id) if video_id else None


def content_type_for(url: object) -> ContentType:
    """``'video'`` for a YouTube video link, ``'page'`` for every other citation."""
    return 'video' if youtube_video_id(url) else 'page'


def stored_content_type(value: object, url: object) -> ContentType:
    """A stored ``content_type`` when it is one of ``CONTENT_TYPES``, else the type derived from ``url``.

    Rows written before content types existed carry none.
    """
    if value == 'video':
        return 'video'
    if value == 'page':
        return 'page'
    return content_type_for(url)


__all__ = [
    'CONTENT_TYPES',
    'YOUTUBE_VIDEO_ID',
    'ContentType',
    'canonical_youtube_url',
    'canonical_youtube_url_for_id',
    'content_type_for',
    'stored_content_type',
    'youtube_video_id',
]
