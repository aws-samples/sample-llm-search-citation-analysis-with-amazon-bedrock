"""AI-readiness checks: crawler access (``shared.audit_geo``), llms.txt, organization markup, the summary."""

from __future__ import annotations

from shared.audit_fetch import FetchResult
from shared.audit_geo import AI_CRAWLERS, bot_access, organization_issues, robots_issues
from shared.audit_issues import ISSUE_TYPES
from shared.audit_llms_txt import llms_issues, read_llms_txt
from shared.audit_robots import policy_for
from shared.site_audit_summary import health_score, summarize

START = 'https://www.example.com/'


def accesses_for(robots: str, paths: list[str] | None = None):
    policy = policy_for(200, robots)
    return policy, bot_access(policy, paths or ['/'])


def issue_types(robots: str, paths: list[str] | None = None) -> list[str]:
    policy, accesses = accesses_for(robots, paths)
    return sorted(issue.issue_type for issue in robots_issues(policy, accesses, START))


def test_every_ai_crawler_class_is_listed_in_one_constant():
    assert {crawler.bot_class for crawler in AI_CRAWLERS} == {'search', 'user_fetch', 'training'}


def test_open_robots_has_no_ai_readiness_issue():
    assert issue_types('User-agent: *\nAllow: /\n') == []


def test_blocking_a_search_bot_on_the_home_page_is_critical():
    assert issue_types('User-agent: PerplexityBot\nDisallow: /\n') == ['ai-search-bot-blocked']


def test_blocked_search_bot_details_name_the_bot_rule_and_line():
    policy, accesses = accesses_for('User-agent: PerplexityBot\nDisallow: /\n')

    assert robots_issues(policy, accesses, START)[0].details == {
        'bots': ['PerplexityBot'], 'matched_rule': 'Disallow: /', 'line': 2,
    }


def test_blocking_some_pages_for_a_search_bot_is_partial():
    assert issue_types('User-agent: Bingbot\nDisallow: /private/\n', ['/', '/private/a']) == [
        'ai-search-bot-partially-blocked',
    ]


def test_blocking_user_fetchers_is_reported():
    assert issue_types('User-agent: ChatGPT-User\nDisallow: /\n') == ['ai-user-fetch-blocked']


def test_blocking_only_training_bots_is_informational():
    types = issue_types('User-agent: GPTBot\nDisallow: /\n')

    assert (types, ISSUE_TYPES[types[0]].severity) == (['ai-training-bot-blocked'], 'info')


def test_search_blocked_while_training_allowed_is_an_inverted_policy():
    assert 'ai-search-blocked-training-allowed' in issue_types('User-agent: OAI-SearchBot\nDisallow: /\n')


def test_unreachable_robots_is_one_issue_instead_of_every_bot_blocked():
    policy = policy_for(503, '')

    assert [issue.issue_type for issue in robots_issues(policy, bot_access(policy, ['/']), START)] == ['robots-unreachable']


def test_start_page_without_organization_or_website_markup_is_reported():
    assert [issue.issue_type for issue in organization_issues(START, ['WebPage'], 0, 0)] == ['organization-schema-missing']


def test_organization_without_same_as_is_reported():
    assert [issue.issue_type for issue in organization_issues(START, ['Organization'], 1, 0)] == ['organization-sameas-missing']


def test_website_markup_alone_satisfies_the_start_page_check():
    assert organization_issues(START, ['WebSite'], 0, 0) == []


def llms(body: str, status: int = 200, content_type: str = 'text/markdown') -> FetchResult:
    return FetchResult(url=f'{START}llms.txt', status=status, headers={'content-type': content_type}, body=body.encode())


def test_llms_txt_with_an_h1_is_present_and_lists_same_site_links():
    found = read_llms_txt(llms('# Example Air\n> Flights\n- [Fares](/fares)\n- [Partner](https://acme.example.org/)\n'))

    assert (found.state, found.links) == ('present', ('https://www.example.com/fares',))


def test_llms_txt_served_as_html_is_invalid():
    assert read_llms_txt(llms('# Example', content_type='text/html')).state == 'invalid'


def test_llms_txt_without_an_h1_is_invalid():
    assert read_llms_txt(llms('Example Air\n')).state == 'invalid'


def test_missing_llms_txt_is_informational():
    issues = llms_issues(read_llms_txt(llms('', status=404)), START, [])

    assert [(issue.issue_type, issue.descriptor.severity) for issue in issues] == [('llms-txt-missing', 'info')]


def test_broken_llms_txt_links_are_listed():
    issues = llms_issues(read_llms_txt(llms('# E\n- [a](/a)\n')), START, ['https://www.example.com/a'])

    assert issues[0].details == {'broken_urls': ['https://www.example.com/a']}


def test_every_ai_readiness_type_sits_in_the_ai_readiness_group():
    geo = [key for key in ISSUE_TYPES if key.startswith(('ai-', 'llms-', 'robots-', 'organization-', 'structured-'))]

    assert {ISSUE_TYPES[key].group for key in geo} == {'ai_readiness'}


def test_the_registry_holds_every_seo_and_ai_readiness_type():
    assert len(ISSUE_TYPES) == 30 + 21


def test_a_clean_crawl_scores_one_hundred():
    assert health_score({}, 50) == 100


def test_a_critical_type_on_every_page_costs_fifteen_points():
    assert health_score({'missing-title': 10}, 10) == 85


def test_summary_counts_issues_by_severity_and_group():
    items = [{'issue_type': 'missing-title', 'page_url': 'a'}, {'issue_type': 'llms-txt-missing', 'page_url': START}]
    summary = summarize(items, 2)

    assert (summary['counts_by_severity'], summary['counts_by_group']['ai_readiness']) == (
        {'critical': 1, 'warning': 0, 'info': 1}, 1,
    )
