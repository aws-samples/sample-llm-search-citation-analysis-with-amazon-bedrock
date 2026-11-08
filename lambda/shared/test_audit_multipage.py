"""Cross-page checks (``shared.audit_multipage``)."""

from __future__ import annotations

from shared.audit_multipage import PageSummary, broken_link_issues, duplicate_issues, multipage_issues, redirect_issues

SITE = 'https://www.example.com'
START = f'{SITE}/'


def live(path: str, **fields) -> PageSummary:
    return PageSummary(url=f'{SITE}{path}', status=200, fetch_class='ok', is_html=True, **fields)


def moved(path: str, target: str) -> PageSummary:
    return PageSummary(url=f'{SITE}{path}', status=301, fetch_class='ok', redirect_url=f'{SITE}{target}')


def issue_map(issues) -> list[tuple[str, str]]:
    return sorted((issue.issue_type, issue.page_url.removeprefix(SITE)) for issue in issues)


def test_pages_sharing_a_title_each_get_a_duplicate_issue():
    pages = [live('/a', title='Same'), live('/b', title='Same'), live('/c', title='Other')]

    assert issue_map(duplicate_issues(pages)) == [('duplicate-title', '/a'), ('duplicate-title', '/b')]


def test_duplicate_details_list_the_group_size_and_other_urls():
    issues = duplicate_issues([live('/a', title='Same'), live('/b', title='Same')])

    assert issues[0].details == {'group_size': 2, 'other_urls': [f'{SITE}/b']}


def test_canonicalized_and_noindex_pages_are_not_duplicate_candidates():
    pages = [live('/a', title='Same'), live('/b', title='Same', canonical=f'{SITE}/a'), live('/c', title='Same', indexable=False)]

    assert duplicate_issues(pages) == []


def test_duplicate_content_needs_at_least_one_word():
    pages = [live('/a', content_hash='h', word_count=0), live('/b', content_hash='h', word_count=0)]

    assert duplicate_issues(pages) == []


def test_two_redirects_in_a_row_are_a_chain():
    pages = [moved('/a', '/b'), moved('/b', '/c'), live('/c')]

    assert issue_map(redirect_issues(pages)) == [('redirect-chain', '/a')]


def test_a_single_redirect_is_not_a_chain():
    assert redirect_issues([moved('/a', '/b'), live('/b')]) == []


def test_a_chain_that_comes_back_is_a_loop():
    pages = [moved('/a', '/b'), moved('/b', '/c'), moved('/c', '/b')]

    assert issue_map(redirect_issues(pages)) == [('redirect-loop', '/a')]


def test_a_headless_cycle_is_one_loop_on_its_smallest_url():
    pages = [moved('/x', '/y'), moved('/y', '/x')]

    assert issue_map(redirect_issues(pages)) == [('redirect-loop', '/x')]


def test_a_self_redirect_is_a_loop():
    assert issue_map(redirect_issues([moved('/self', '/self')])) == [('redirect-loop', '/self')]


def test_a_link_to_a_404_is_a_broken_internal_link_on_the_source_page():
    pages = [live('/a', internal_links=(f'{SITE}/gone',)), PageSummary(url=f'{SITE}/gone', status=404, fetch_class='ok')]

    assert issue_map(broken_link_issues(pages)) == [('broken-internal-link', '/a')]


def test_a_link_to_a_blocked_target_is_not_broken():
    pages = [live('/a', internal_links=(f'{SITE}/b',)), PageSummary(url=f'{SITE}/b', status=403, fetch_class='blocked')]

    assert broken_link_issues(pages) == []


def test_an_unlinked_live_page_is_an_orphan_when_the_crawl_completed():
    pages = [live('/', internal_links=(f'{SITE}/a',)), live('/a'), live('/lonely')]

    assert issue_map(multipage_issues(pages, START, crawl_complete=True)) == [('orphan-page', '/lonely')]


def test_orphans_are_not_judged_when_the_crawl_stopped_early():
    pages = [live('/'), live('/lonely')]

    assert multipage_issues(pages, START, crawl_complete=False) == []


def test_orphans_are_not_judged_when_a_page_is_a_javascript_shell():
    pages = [live('/', javascript_shell=True), live('/lonely')]

    assert multipage_issues(pages, START, crawl_complete=True) == []


def test_a_redirect_target_is_not_an_orphan():
    pages = [live('/'), moved('/old', '/new'), live('/new')]

    assert [kind for kind, _ in issue_map(multipage_issues(pages, START, crawl_complete=True))] == []
