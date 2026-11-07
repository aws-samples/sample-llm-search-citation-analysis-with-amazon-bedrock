"""URL rules of the site audit (``shared.audit_urls``)."""

from __future__ import annotations

import pytest

from shared.audit_urls import (
    StartUrlError,
    is_crawlable,
    is_same_origin,
    normalize_url,
    path_and_query,
    start_url_for,
)


def test_normalize_keeps_the_trailing_slash_when_the_path_has_one():
    assert normalize_url('https://www.example.com/path/') == 'https://www.example.com/path/'


def test_normalize_sorts_query_parameters_and_drops_the_fragment():
    assert normalize_url('https://example.com/a?b=2&a=1#top') == 'https://example.com/a?a=1&b=2'


def test_normalize_lowercases_the_host_and_drops_the_default_port():
    assert normalize_url('HTTPS://WWW.Example.COM:443') == 'https://www.example.com/'


def test_normalize_resolves_a_relative_link_against_the_page():
    assert normalize_url('../b', 'https://example.com/a/c') == 'https://example.com/b'


@pytest.mark.parametrize('url', ['mailto:a@example.com', 'ftp://example.com/', '', '   ', 'https://'])
def test_normalize_refuses_a_url_that_is_not_http(url):
    assert normalize_url(url) is None


def test_www_twin_is_the_same_origin():
    assert is_same_origin('https://www.example.com/a', 'https://example.com/b')


def test_http_to_https_upgrade_is_the_same_origin():
    assert is_same_origin('http://example.com/', 'https://example.com/')


def test_another_subdomain_is_not_the_same_origin():
    assert not is_same_origin('https://blog.example.com/', 'https://www.example.com/')


def test_a_different_port_is_not_the_same_origin():
    assert not is_same_origin('https://example.com:8443/', 'https://example.com/')


@pytest.mark.parametrize('url', [
    'http://localhost/', 'http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data',
    'http://metadata.google.internal/', 'http://printer.local/', 'http://[::1]/', 'http://10.0.0.5/',
    'https://user:pass@example.com/', 'https://example.com:8080/', 'http://2130706433/',
])
def test_internal_or_unusual_targets_are_not_crawlable(url):
    assert not is_crawlable(url)


def test_a_public_https_url_is_crawlable():
    assert is_crawlable('https://www.example.com/page')


def test_path_and_query_is_what_robots_rules_match():
    assert path_and_query('https://example.com/a/b?x=1') == '/a/b?x=1'


def test_start_url_gets_https_when_no_scheme_is_given():
    assert start_url_for('www.example.com', ['example.com']) == 'https://www.example.com/'


def test_start_url_is_refused_when_not_an_owned_domain():
    with pytest.raises(StartUrlError, match="brand's own domains"):
        start_url_for('https://acme.example.org/', ['example.com'])


def test_start_url_is_refused_when_no_owned_domain_is_configured():
    with pytest.raises(StartUrlError, match='Brand Tracking'):
        start_url_for('https://example.com/', [])


def test_start_url_is_refused_when_it_points_at_an_internal_address():
    with pytest.raises(StartUrlError, match='public http'):
        start_url_for('http://127.0.0.1/', ['127.0.0.1'])


def test_start_url_accepts_a_subdomain_of_an_owned_domain():
    assert start_url_for('https://shop.example.com/de/', ['example.com']) == 'https://shop.example.com/de/'
