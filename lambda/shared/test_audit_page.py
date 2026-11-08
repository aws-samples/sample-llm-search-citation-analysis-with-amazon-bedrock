"""HTML extraction (``shared.audit_page``), structured data (``shared.audit_structured``) and directives."""

from __future__ import annotations

import pytest

from shared.audit_directives import (
    is_indexable,
    link_header_canonical,
    noindex_for_bing_only,
    parse_x_robots_tag,
    snippet_restrictions,
)
from shared.audit_page import analyze_page
from shared.audit_structured import read_json_ld

URL = 'https://www.example.com/blog/'


def test_links_skip_non_http_schemes_and_fragments():
    html = '<a href="mailto:x@example.com">m</a><a href="#top">t</a><a href="javascript:void(0)">j</a><a href="/a">a</a>'

    assert [link.url for link in analyze_page(html, URL).links] == ['https://www.example.com/a']


def test_links_are_deduplicated_by_target():
    html = '<a href="/a">one</a><a href="https://www.example.com/a#x">two</a>'

    assert len(analyze_page(html, URL).links) == 1


def test_www_twin_links_are_internal_and_other_hosts_external():
    facts = analyze_page('<a href="https://example.com/x">i</a><a href="https://acme.example.org/">e</a>', URL)

    assert [link.internal for link in facts.links] == [True, False]


def test_nofollow_is_read_from_rel():
    assert analyze_page('<a href="/a" rel="nofollow noopener">a</a>', URL).links[0].nofollow


def test_visible_text_leaves_out_scripts_styles_and_head():
    html = '<head><title>T</title></head><body><script>var a = 1</script><style>.a{}</style><p>one two</p></body>'

    assert analyze_page(html, URL).word_count == 2


def test_meta_names_are_case_insensitive_and_the_first_wins():
    html = '<meta name="Description" content="first"><meta name="description" content="second">'

    assert analyze_page(html, URL).meta_description == 'first'


def test_title_inside_svg_is_ignored():
    html = '<svg><title>icon</title></svg><title>Real title</title>'

    assert analyze_page(html, URL).title == 'Real title'


def test_h1_count_skips_empty_headings():
    facts = analyze_page('<h1></h1><h1>Main</h1><h2>Sub</h2>', URL)

    assert (facts.h1_count, facts.first_h1, facts.headings) == (1, 'Main', (1, 1, 2))


def test_images_without_alt_are_counted_but_empty_alt_is_fine():
    facts = analyze_page('<img src="a.png"><img src="b.png" alt=""><img src="c.png" alt="c">', URL)

    assert (facts.images_total, facts.images_missing_alt) == (3, 1)


def test_canonical_is_resolved_against_the_page():
    assert analyze_page('<link rel="canonical" href="/blog/">', URL).canonical == URL


def test_json_ld_with_parameters_and_uppercase_type_is_collected():
    html = '<script type="Application/LD+JSON; charset=utf-8">{"@type": "Organization"}</script>'

    assert analyze_page(html, URL).json_ld == ('{"@type": "Organization"}',)


def test_app_shell_with_a_script_and_no_content_is_a_javascript_shell():
    html = '<html><head><script src="/app.js"></script></head><body><div id="root"></div></body></html>'

    assert analyze_page(html, URL).javascript_shell


def test_server_rendered_page_with_an_app_root_is_not_a_shell():
    html = '<body><div id="__next"><h1>Hello</h1><a href="/a">a</a></div><script src="/x.js"></script></body>'

    assert not analyze_page(html, URL).javascript_shell


def test_bot_specific_robots_meta_is_kept():
    html = '<meta name="robots" content="index"><meta name="BINGBOT" content="noindex">'

    assert analyze_page(html, URL).bot_meta == {'robots': 'index', 'bingbot': 'noindex'}


def test_json_ld_graph_is_flattened_and_types_shortened():
    data = read_json_ld(['{"@graph": [{"@type": "schema:Organization", "sameAs": ["https://x.example.org/"]},'
                         ' {"@type": ["WebSite", "https://schema.org/WebPage"]}]}'])

    assert (data.types, data.organizations, data.organizations_with_same_as) == (
        ('Organization', 'WebPage', 'WebSite'), 1, 1,
    )


def test_invalid_json_ld_is_reported_with_its_block_index():
    data = read_json_ld(['{"@type": "Thing"}', '{not json'])

    assert [index for index, _message in data.errors] == [1]


def test_an_object_without_type_is_an_error():
    assert read_json_ld(['{"name": "x"}']).errors == ((0, 'An object has no @type'),)


def test_faq_question_count_is_read_from_main_entity():
    data = read_json_ld(['{"@type": "FAQPage", "mainEntity": [{"@type": "Question"}, {"@type": "Question"}]}'])

    assert data.faq_question_counts == (2,)


def test_local_business_counts_as_an_organization():
    assert read_json_ld(['{"@type": "LocalBusiness"}']).organizations == 1


def test_x_robots_tag_directives_are_split_per_bot():
    assert parse_x_robots_tag('noarchive, googlebot: nosnippet, max-snippet: 0, bingbot: noindex') == {
        '*': ('noarchive',), 'googlebot': ('nosnippet', 'max-snippet:0'), 'bingbot': ('noindex',),
    }


def test_max_snippet_value_is_not_read_as_a_bot_name():
    assert parse_x_robots_tag('max-snippet: 0') == {'*': ('max-snippet:0',)}


@pytest.mark.parametrize(('meta', 'header', 'expected'), [
    ('noindex, follow', '', False), ('', 'googlebot: noindex', False), ('index', '', True),
])
def test_noindex_anywhere_makes_a_page_not_indexable(meta, header, expected):
    assert is_indexable(meta, header) is expected


def test_snippet_restrictions_collect_meta_and_header_opt_outs():
    assert snippet_restrictions({'robots': 'max-snippet:0'}, 'googlebot: nosnippet') == [
        'googlebot:nosnippet', 'max-snippet:0',
    ]


def test_bing_only_noindex_is_detected_when_generic_robots_allow():
    assert noindex_for_bing_only({'robots': 'index', 'bingbot': 'noindex'}, '')


def test_bing_noindex_is_not_bing_only_when_generic_robots_also_noindex():
    assert not noindex_for_bing_only({'robots': 'noindex', 'bingbot': 'noindex'}, '')


def test_link_header_canonical_is_read():
    assert link_header_canonical('<https://www.example.com/a>; rel="canonical"') == 'https://www.example.com/a'
