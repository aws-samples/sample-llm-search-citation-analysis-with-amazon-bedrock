"""Tests for shared.backlinks_target: what a typed domain or URL is sent to the Backlinks API as."""

from __future__ import annotations

import pytest

from shared.backlinks_target import (
    CREDENTIALS_MESSAGE,
    EMPTY_TARGET_MESSAGE,
    INVALID_DOMAIN_MESSAGE,
    PAGE_QUERY_MESSAGE,
    BacklinksTarget,
    InvalidTargetError,
    backlinks_target,
    is_registrable_host,
    resolve_scope,
)


def test_targets_the_host_with_subdomains_when_a_bare_domain_has_no_scope():
    assert backlinks_target('Example.com') == BacklinksTarget(
        scope='subdomains', api_target='example.com', include_subdomains=True, path='', hostname='example.com',
        display='example.com',
    )


def test_targets_a_subfolder_when_the_input_has_a_path():
    assert backlinks_target('https://www.example.com/blog/posts/') == BacklinksTarget(
        scope='subfolder', api_target='example.com', include_subdomains=False, path='/blog/posts',
        hostname='example.com', display='example.com/blog/posts',
    )


def test_excludes_subdomains_for_domain_scope():
    target = backlinks_target('www.example.com', 'domain')

    assert (target.api_target, target.include_subdomains, target.path) == ('example.com', False, '')


def test_drops_the_path_for_domain_scope_on_a_url_with_a_path():
    assert backlinks_target('example.com/blog', 'domain').display == 'example.com'


def test_sends_the_https_root_page_when_a_bare_domain_is_an_exact_url():
    assert backlinks_target('Example.com', 'exact_url').api_target == 'https://example.com/'


def test_keeps_www_and_an_explicit_http_scheme_for_an_exact_page():
    assert backlinks_target('http://www.example.com/pricing/', 'exact_url').api_target == 'http://www.example.com/pricing'


def test_reads_the_legacy_page_scope_as_exact_url():
    assert backlinks_target('example.com/a', 'page').scope == 'exact_url'


@pytest.mark.parametrize('text', ['example.com/page?ref=1', 'example.com/page#top'])
def test_refuses_an_exact_page_with_a_query_or_fragment(text):
    with pytest.raises(InvalidTargetError, match=PAGE_QUERY_MESSAGE):
        backlinks_target(text, 'exact_url')


def test_drops_the_query_and_fragment_for_a_subfolder():
    assert backlinks_target('example.com/blog/?page=2#x').path == '/blog'


def test_refuses_subfolder_scope_without_a_path():
    with pytest.raises(InvalidTargetError, match=r'Add a path to use Subfolder'):
        backlinks_target('example.com/', 'subfolder')


@pytest.mark.parametrize('text', ['my_site.com', 'localhost', '192.168.0.1', 'example', 'exa mple.com',
                                  '-example.com', 'example.123', 'ftp://example.com', 'https://'])
def test_refuses_hosts_the_backlinks_api_would_bill_and_fail(text):
    with pytest.raises(InvalidTargetError, match=INVALID_DOMAIN_MESSAGE):
        backlinks_target(text)


def test_refuses_a_url_with_embedded_credentials():
    with pytest.raises(InvalidTargetError, match=CREDENTIALS_MESSAGE):
        backlinks_target('https://user:secret@example.com/')


@pytest.mark.parametrize('text', ['', '   '])
def test_refuses_an_empty_target(text):
    with pytest.raises(InvalidTargetError, match=EMPTY_TARGET_MESSAGE):
        backlinks_target(text)


def test_refuses_a_target_longer_than_2048_characters():
    with pytest.raises(InvalidTargetError, match='2048'):
        backlinks_target(f'example.com/{"a" * 2048}')


def test_sends_an_internationalized_host_in_its_ascii_form():
    assert backlinks_target('café.example').api_target == 'xn--caf-dma.example'


def test_ignores_the_port_of_the_input():
    assert backlinks_target('example.com:8080').api_target == 'example.com'


def test_refuses_an_unknown_scope():
    with pytest.raises(InvalidTargetError, match='scope must be one of'):
        resolve_scope('folder')


@pytest.mark.parametrize(('text', 'expected'), [
    ('example.com', 'subdomains'), ('example.com/', 'subdomains'), ('example.com/blog', 'subfolder'),
])
def test_implies_the_scope_of_the_input_when_no_scope_is_given(text, expected):
    assert backlinks_target(text).scope == expected


@pytest.mark.parametrize(('host', 'expected'), [
    ('example.com', True), ('a.b.example.co.uk', True), ('xn--caf-dma.example', True), ('example.c', False),
    (f'{"a" * 64}.com', False), ('example-.com', False), ('example..com', False),
])
def test_recognises_registrable_hosts(host, expected):
    assert is_registrable_host(host) is expected


def test_keeps_the_path_casing_of_a_subfolder():
    assert backlinks_target('example.com/Blog').path == '/Blog'
