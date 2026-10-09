"""Tests for the YouTube oEmbed read the crawler uses instead of a browser (``shared.youtube_oembed``)."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock

import pytest

from shared.youtube_oembed import (
    MAX_OEMBED_BYTES,
    OEMBED_TIMEOUT_SECONDS,
    VideoMetadata,
    VideoMetadataError,
    fetch_video_metadata,
    oembed_request_url,
)

_VIDEO_ID = 'dQw4w9WgXcQ'
_OEMBED_URL = 'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&format=json'
# Trimmed from a live answer (2026-10-08) for the video above; `html` shortened.
_LIVE_DOCUMENT: dict[str, Any] = {
    'title': 'Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)',
    'author_name': 'Rick Astley',
    'author_url': 'https://www.youtube.com/@RickAstleyYT',
    'type': 'video',
    'height': 113,
    'width': 200,
    'version': '1.0',
    'provider_name': 'YouTube',
    'provider_url': 'https://www.youtube.com/',
    'thumbnail_height': 360,
    'thumbnail_width': 480,
    'thumbnail_url': 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    'html': '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?feature=oembed"></iframe>',
}


def _response(status: int = 200, body: bytes | None = None, headers: dict[str, str] | None = None) -> MagicMock:
    response = MagicMock()
    response.status_code = status
    response.headers = headers or {'Content-Type': 'application/json'}
    response.raw.read.return_value = json.dumps(_LIVE_DOCUMENT).encode() if body is None else body
    return response


def _fetcher(response: MagicMock | None, final_url: str | None = _OEMBED_URL, error: str = '') -> MagicMock:
    return MagicMock(return_value=(response, final_url if response is not None else None, error))


def _metadata_for(document: dict[str, Any]) -> VideoMetadata:
    return fetch_video_metadata(_VIDEO_ID, fetcher=_fetcher(_response(body=json.dumps(document).encode())))


def _error_for(fetcher: MagicMock, video_id: str = _VIDEO_ID) -> str:
    with pytest.raises(VideoMetadataError) as raised:
        fetch_video_metadata(video_id, fetcher=fetcher)
    return str(raised.value)


def test_builds_the_oembed_request_for_the_canonical_watch_url():
    assert oembed_request_url(_VIDEO_ID) == _OEMBED_URL


def test_reads_title_channel_and_thumbnail_from_the_live_answer():
    assert _metadata_for(_LIVE_DOCUMENT) == VideoMetadata(
        title='Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)',
        author_name='Rick Astley',
        author_url='https://www.youtube.com/@RickAstleyYT',
        thumbnail_url='https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    )


def test_requests_the_pinned_endpoint_without_following_redirects_with_a_timeout_and_a_streamed_body():
    fetcher = _fetcher(_response())

    fetch_video_metadata(_VIDEO_ID, fetcher=fetcher)

    fetcher.assert_called_once_with(
        _OEMBED_URL,
        timeout=OEMBED_TIMEOUT_SECONDS,
        max_hops=0,
        stream=True,
        headers={'Accept': 'application/json'},
    )


def test_reads_at_most_one_byte_past_the_size_cap():
    response = _response()

    fetch_video_metadata(_VIDEO_ID, fetcher=_fetcher(response))

    response.raw.read.assert_called_once_with(MAX_OEMBED_BYTES + 1, decode_content=True)


def test_closes_the_response_after_reading_it():
    response = _response()

    fetch_video_metadata(_VIDEO_ID, fetcher=_fetcher(response))

    response.close.assert_called_once_with()


@pytest.mark.parametrize(('status', 'message'), [
    pytest.param(401, 'YouTube does not allow this video to be embedded (HTTP 401)', id='401-not-embeddable'),
    pytest.param(403, 'YouTube refused the video details: embedding is disabled (HTTP 403)', id='403-embedding-disabled'),
    pytest.param(404, 'YouTube video not found: removed or private (HTTP 404)', id='404-removed-or-private'),
    pytest.param(503, 'YouTube video details unavailable (HTTP 503)', id='503-other-status'),
])
def test_raises_the_status_reason_when_youtube_refuses_the_video(status, message):
    assert _error_for(_fetcher(_response(status=status))) == message


def test_closes_the_response_when_youtube_refuses_the_video():
    response = _response(status=404)

    _error_for(_fetcher(response))

    response.close.assert_called_once_with()


def test_raises_the_safe_fetch_reason_when_the_request_is_refused():
    assert _error_for(_fetcher(None, error='Too many redirects')) == (
        'Could not fetch the YouTube video details (Too many redirects)'
    )


def test_raises_when_the_answer_comes_from_another_host():
    fetcher = _fetcher(_response(), final_url='https://www.youtube.com.evil.example/oembed')

    assert _error_for(fetcher) == 'YouTube video details came from an unexpected host'


def test_refuses_a_body_declared_larger_than_the_cap_without_reading_it():
    response = _response(headers={'Content-Length': str(MAX_OEMBED_BYTES + 1)})

    assert _error_for(_fetcher(response)) == 'YouTube video details are too large'
    response.raw.read.assert_not_called()


def test_refuses_a_body_longer_than_the_cap():
    response = _response(body=b' ' * (MAX_OEMBED_BYTES + 1))

    assert _error_for(_fetcher(response)) == 'YouTube video details are too large'


class _ReadFailureError(OSError):
    """A connection dropped while the body was read."""


def test_raises_when_the_body_cannot_be_read():
    response = _response()
    response.raw.read.side_effect = _ReadFailureError('connection reset')

    assert _error_for(_fetcher(response)) == 'Could not read the YouTube video details'


@pytest.mark.parametrize('body', [b'<html>consent</html>', b'[]', b'"title"'])
def test_raises_when_the_body_is_not_a_json_object(body):
    assert _error_for(_fetcher(_response(body=body))) == 'YouTube returned unreadable video details'


@pytest.mark.parametrize('title', [None, '', '   ', 42])
def test_raises_when_the_answer_has_no_title(title):
    document = {**_LIVE_DOCUMENT, 'title': title}

    assert _error_for(_fetcher(_response(body=json.dumps(document).encode()))) == (
        'YouTube returned video details without a title'
    )


@pytest.mark.parametrize('video_id', ['', 'short', 'dQw4w9WgXcQ&x=1', '../../oembed'])
def test_refuses_an_invalid_video_id_without_a_request(video_id):
    fetcher = _fetcher(_response())

    assert _error_for(fetcher, video_id) == 'Not a YouTube video id'
    fetcher.assert_not_called()


@pytest.mark.parametrize('link', [
    pytest.param('http://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', id='http'),
    pytest.param('javascript:alert(1)', id='javascript-uri'),
    pytest.param('//i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', id='protocol-relative'),
    pytest.param('https://', id='no-host'),
    pytest.param('https://[i.ytimg.com/x.jpg', id='unparseable'),
    pytest.param('https://i.ytimg.com/' + 'a' * 600, id='too-long'),
    pytest.param(7, id='not-a-string'),
])
def test_drops_a_thumbnail_that_is_not_a_plain_https_link(link):
    assert _metadata_for({**_LIVE_DOCUMENT, 'thumbnail_url': link}).thumbnail_url == ''


def test_drops_a_channel_link_that_is_not_https():
    assert _metadata_for({**_LIVE_DOCUMENT, 'author_url': 'http://www.youtube.com/@x'}).author_url == ''


def test_keeps_a_video_without_a_channel_name():
    assert _metadata_for({'title': 'Untitled upload'}).author_name == ''


def test_truncates_an_overlong_title_to_five_hundred_characters():
    assert _metadata_for({'title': 'T' * 900}).title == 'T' * 500


class TestStoredText:
    _VIDEO = VideoMetadata(
        title='Paella at home',
        author_name='Cocina',
        author_url='https://www.youtube.com/@cocina',
        thumbnail_url='https://i.ytimg.com/vi/x/hqdefault.jpg',
    )

    def test_summarises_the_video_with_its_channel(self):
        assert self._VIDEO.summary() == 'YouTube video "Paella at home" by Cocina.'

    def test_summarises_a_video_without_a_channel_by_title_alone(self):
        assert VideoMetadata('Paella at home', '', '', '').summary() == 'YouTube video "Paella at home".'

    def test_records_title_channel_and_links_as_the_content(self):
        assert self._VIDEO.content('https://www.youtube.com/watch?v=dQw4w9WgXcQ') == (
            'Paella at home\nChannel: Cocina\nhttps://www.youtube.com/@cocina\n'
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
        )

    def test_leaves_missing_channel_lines_out_of_the_content(self):
        assert VideoMetadata('Paella at home', '', '', '').content('https://www.youtube.com/watch?v=x') == (
            'Paella at home\nhttps://www.youtube.com/watch?v=x'
        )
