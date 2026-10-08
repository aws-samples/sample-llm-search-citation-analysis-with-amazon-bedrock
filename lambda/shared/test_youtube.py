"""Tests for YouTube video link recognition (``shared.youtube``), pinned by test-fixtures/youtube-urls.json."""

import json
from pathlib import Path

import pytest

from shared.utils import normalize_url
from shared.youtube import (
    canonical_youtube_url,
    content_type_for,
    stored_content_type,
    youtube_video_id,
)

# `.resolve()` first: see test_keyword_identity.py (sys.path entries make `__file__` unnormalized).
_FIXTURES_PATH = Path(__file__).resolve().parents[2] / 'test-fixtures' / 'youtube-urls.json'
_CASES = json.loads(_FIXTURES_PATH.read_text(encoding='utf-8'))['cases']
_VIDEO_CASES = [case for case in _CASES if case['videoId'] is not None]
_PAGE_CASES = [case for case in _CASES if case['videoId'] is None]


def _case_id(case: dict) -> str:
    return case['description']


@pytest.mark.parametrize('case', _CASES, ids=_case_id)
def test_reads_the_fixture_video_id_from_every_link(case):
    assert youtube_video_id(case['url']) == case['videoId']


@pytest.mark.parametrize('case', _VIDEO_CASES, ids=_case_id)
def test_returns_the_canonical_watch_url_when_the_link_is_a_video(case):
    assert canonical_youtube_url(case['url']) == f"https://www.youtube.com/watch?v={case['videoId']}"


@pytest.mark.parametrize('case', _PAGE_CASES, ids=_case_id)
def test_returns_no_canonical_url_when_the_link_is_not_a_video(case):
    assert canonical_youtube_url(case['url']) is None


@pytest.mark.parametrize('case', _VIDEO_CASES, ids=_case_id)
def test_classifies_a_video_link_as_video(case):
    assert content_type_for(case['url']) == 'video'


@pytest.mark.parametrize('case', _PAGE_CASES, ids=_case_id)
def test_classifies_every_other_link_as_page(case):
    assert content_type_for(case['url']) == 'page'


@pytest.mark.parametrize('case', _VIDEO_CASES, ids=_case_id)
def test_normalize_url_collapses_every_video_link_to_the_canonical_watch_url(case):
    assert normalize_url(case['url']) == f"https://www.youtube.com/watch?v={case['videoId']}"


def test_normalize_url_keeps_stripping_tracking_parameters_from_a_youtube_channel_page():
    assert normalize_url('https://www.youtube.com/@brand?utm_source=chatgpt&tab=videos') == (
        'https://www.youtube.com/@brand?tab=videos'
    )


@pytest.mark.parametrize('value', [None, 42, b'https://youtu.be/dQw4w9WgXcQ', ['https://youtu.be/dQw4w9WgXcQ']])
def test_reads_no_video_id_when_the_value_is_not_a_string(value):
    assert youtube_video_id(value) is None


def test_reads_no_video_id_when_the_url_is_unparseable():
    assert youtube_video_id('https://[www.youtube.com/watch?v=dQw4w9WgXcQ') is None


class TestStoredContentType:
    def test_keeps_a_stored_video_type_when_the_url_looks_like_a_page(self):
        assert stored_content_type('video', 'https://example.com/article') == 'video'

    def test_keeps_a_stored_page_type_when_the_url_looks_like_a_video(self):
        assert stored_content_type('page', 'https://youtu.be/dQw4w9WgXcQ') == 'page'

    @pytest.mark.parametrize('stored', [None, '', 'Video', 'audio', 3])
    def test_derives_the_type_from_the_url_when_the_stored_value_is_missing_or_unknown(self, stored):
        assert stored_content_type(stored, 'https://youtu.be/dQw4w9WgXcQ') == 'video'
