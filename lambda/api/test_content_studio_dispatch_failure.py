"""
REGRESSION (AUDIT-2026-08-19 §2.9): a failed async dispatch must not run the
generation on the client's request.

`POST /content-studio/generate` is async by design — it writes a `pending` row,
fires a self-invocation, and returns immediately so the client can poll. But
`shared/self_invoke.py` used to catch every exception from `invoke` and call the
fallback, and the fallback here IS `_process_generation_async`. So when dispatch
failed, the full Bedrock generation ran inline on an API-Gateway request:

- the client got a 504 at the gateway's hard 29s ceiling and lost the response
- the function kept running toward its 300s timeout, billed the model call, and
  wrote the result nobody would see

Worse, the row was left `pending` while the idempotency key (a 5-minute bucket)
meant an immediate user retry returned that same dead row *without* re-invoking
— so the obvious recovery action did nothing.

These tests pin the fail-fast contract: mark the row terminal, return 503, and
never execute the generation here.

The module also characterises the two pipelines behind the endpoints —
`generate_content_ideas` (ideas from brand visibility) and `generate_content`
(the Bedrock prompt, its result shape and its error mapping) — so they can be
restructured without changing what the dashboard sees.
"""

from __future__ import annotations

import json
import os
from unittest.mock import MagicMock, call, patch

import pytest

from shared.content_brief import CONTENT_OUTPUT_CONTRACT
from shared.models import BedrockInvocationError, ModelRole
from shared.prompt_safety import untrusted_input_system_instruction
from shared.self_invoke import SelfInvokeDispatchError
from shared.utils import get_timestamp
from testing.dynamodb_stubs import fake_dynamodb_resource, fake_table
from testing.env import cleared_env, setdefault_env
from testing.module_loader import load_handler_module

setdefault_env({
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-search',
    'DYNAMODB_TABLE_CRAWLED_CONTENT': 'test-crawled',
    'DYNAMODB_TABLE_CONTENT_STUDIO': 'test-content-studio',
    'DYNAMODB_TABLE_KEYWORDS': 'test-keywords',
    'DYNAMODB_TABLE_KEYWORD_GROUPS': 'test-keyword-groups',
})
_mod = load_handler_module(os.path.dirname(__file__), 'content-studio.py', 'content_studio_dispatch_under_test')


IDEA = {'id': 'idea-1', 'keyword': 'best hotels malaga', 'content_angle': 'comprehensive_guide'}


def _generate_event() -> dict:
    return {
        'httpMethod': 'POST',
        'path': '/content-studio/generate',
        'body': json.dumps({'idea': IDEA}),
    }


def _failing_dispatch() -> MagicMock:
    """An `invoke_self_async` whose dispatch fails outright."""
    return MagicMock(side_effect=SelfInvokeDispatchError('boom'))


def _generate(dispatch: MagicMock, update_content_status: MagicMock | None = None) -> dict:
    """Run `_generate_content` over a fresh pending row with `dispatch` as `invoke_self_async`."""
    # A resource whose table accepts the pending write as a fresh row.
    dynamodb = fake_dynamodb_resource(fake_table(get_item={}))
    with (
        patch.object(_mod, 'dynamodb', dynamodb),
        patch.object(_mod, 'update_content_status', update_content_status or MagicMock()),
        patch.object(_mod, 'invoke_self_async', dispatch),
    ):
        return _mod._generate_content(_generate_event(), None)


class TestDispatchFailureReturns503:
    def test_returns_503_when_the_generation_cannot_be_dispatched(self):
        response = _generate(_failing_dispatch())

        assert response['statusCode'] == 503

    def test_does_not_run_the_generation_on_the_request(self):
        """
        The whole point: `_process_generation_async` must not execute here.
        It is the callable handed to `invoke_self_async` as the fallback, so a
        helper that resumed falling back would trip this.
        """
        process = MagicMock()

        with patch.object(_mod, '_process_generation_async', process):
            _generate(_failing_dispatch())

        process.assert_not_called()

    def test_marks_the_row_failed_so_a_retry_is_not_blocked_by_idempotency(self):
        """
        The row must not stay `pending`: within the 5-minute idempotency window
        a retry returns the existing row without re-invoking, so a non-terminal
        row would make the failure permanent and invisible.
        """
        update = MagicMock()

        _generate(_failing_dispatch(), update_content_status=update)

        assert update.call_args.args[1] == 'failed'

    def test_reports_the_failed_status_in_the_response_body(self):
        response = _generate(_failing_dispatch())

        body = json.loads(response['body'])
        assert body['status'] == 'failed'

    def test_returns_pending_and_202_style_success_when_dispatch_works(self):
        """Control: the happy path must be untouched by the new guard."""
        response = _generate(MagicMock())

        body = json.loads(response['body'])
        assert body['status'] == 'pending'


class TestGenerationTimeoutSweep:
    """
    A Lambda timeout is a SIGKILL, so `_process_generation_async`'s `except`
    never runs. The reader-side sweep is the only thing that makes such a death
    observable — and its threshold must sit ABOVE the function's own timeout,
    or it marks live jobs failed and they flip back to `generated` on finish.
    """

    def test_sweep_threshold_exceeds_the_lambda_timeout(self):
        """
        Guards the 240s-vs-300s inversion: the default must leave room for a
        generation that legitimately runs to the 300s ceiling.
        """
        assert _mod.GENERATION_TIMEOUT_SECONDS > 300

    def test_marks_a_row_failed_once_past_the_threshold(self):
        row = {'id': 'abc', 'status': 'generating', 'created_at': '2020-01-01T00:00:00Z'}

        with patch.object(_mod, 'update_content_status', MagicMock()):
            _mod._fail_if_generation_timed_out(row)

        assert row['status'] == 'failed'

    def test_leaves_a_recent_row_untouched(self):
        row = {'id': 'abc', 'status': 'generating', 'created_at': get_timestamp()}
        update = MagicMock()

        with patch.object(_mod, 'update_content_status', update):
            _mod._fail_if_generation_timed_out(row)

        assert row['status'] == 'generating'
        update.assert_not_called()

    def test_leaves_an_already_terminal_row_untouched(self):
        """A completed row must never be rewritten to failed by the sweep."""
        row = {'id': 'abc', 'status': 'generated', 'created_at': '2020-01-01T00:00:00Z'}
        update = MagicMock()

        with patch.object(_mod, 'update_content_status', update):
            _mod._fail_if_generation_timed_out(row)

        assert row['status'] == 'generated'
        update.assert_not_called()



# --- generate_content_ideas -------------------------------------------------

_BRAND_CONFIG = {
    'tracked_brands': {'first_party': ['Hotel Sol'], 'competitors': ['Rival Inn']},
    'industry': 'general',
}


def _search_result(
    keyword: str,
    provider: str = 'openai',
    *,
    brands: list[dict] | None = None,
    citations: list[str] | None = None,
    timestamp: str = '2026-04-18T10:00:00Z',
) -> dict:
    """One SearchResults row as the search Lambda stores it."""
    return {
        'keyword': keyword,
        'timestamp': timestamp,
        'provider': provider,
        'brands': brands or [],
        'citations': citations or [],
    }


def _first_party(rank: int, sentiment: str = 'neutral') -> dict:
    return {'name': 'Hotel Sol', 'rank': rank, 'sentiment': sentiment, 'classification': 'first_party'}


def _competitor(name: str = 'Rival Inn', rank: int = 1) -> dict:
    return {'name': name, 'rank': rank, 'sentiment': 'neutral', 'classification': 'competitor'}


def _ideas(items: list[dict], config: dict | None = None) -> list[dict]:
    """Run `generate_content_ideas` over `items` with the calendar-driven seasonal ideas switched off."""
    with (
        patch.object(_mod, 'load_recent_search_results', MagicMock(return_value=items)),
        patch.object(_mod, '_get_seasonal_suggestions', MagicMock(return_value=[])),
    ):
        return _mod.generate_content_ideas(config or _BRAND_CONFIG)


class TestGenerateContentIdeasPlaceholders:
    """Before there is anything to analyse, the list carries a single non-actionable prompt."""

    def test_asks_for_brand_configuration_when_no_first_party_brand_is_tracked(self):
        ideas = _ideas([], config={'tracked_brands': {'first_party': [], 'competitors': ['Rival Inn']}})

        assert [idea['type'] for idea in ideas] == ['configuration']
        assert ideas[0]['title'] == 'Configure Your Brands First'
        assert ideas[0]['actionable'] is False

    def test_asks_for_a_first_analysis_when_no_search_results_exist(self):
        ideas = _ideas([])

        assert [idea['type'] for idea in ideas] == ['data']
        assert ideas[0]['title'] == 'Run Your First Analysis'
        assert ideas[0]['actionable'] is False


class TestGenerateContentIdeasWithoutBrandData:
    """Rows without extracted brands can only point at their citations."""

    def test_offers_one_citation_analysis_per_keyword_with_deduplicated_urls(self):
        items = [
            _search_result('kw', citations=['https://a.example', 'https://b.example']),
            _search_result('kw', provider='gemini', citations=['https://b.example', 'https://c.example']),
        ]

        ideas = _ideas(items)

        assert [idea['type'] for idea in ideas] == ['citation_opportunity']
        assert ideas[0]['description'] == 'Found 3 unique citations. Brand extraction not yet run for this data.'
        assert sorted(ideas[0]['competitor_urls']) == ['https://a.example', 'https://b.example', 'https://c.example']

    def test_skips_keywords_whose_rows_carry_no_citations(self):
        items = [_search_result('cited', citations=['https://a.example']), _search_result('uncited')]

        ideas = _ideas(items)

        assert [idea['keyword'] for idea in ideas] == ['cited']

    def test_skips_rows_with_a_blank_keyword(self):
        items = [_search_result('', citations=['https://a.example']), _search_result('kw', citations=['https://b.example'])]

        ideas = _ideas(items)

        assert [idea['keyword'] for idea in ideas] == ['kw']

    def test_caps_citation_opportunities_at_thirty(self):
        items = [_search_result(f'kw{n:02d}', citations=['https://a.example']) for n in range(40)]

        ideas = _ideas(items)

        assert len(ideas) == 30


class TestGenerateContentIdeasFromBrandVisibility:
    """One keyword's latest results decide which of the five idea types it earns."""

    def test_flags_a_visibility_gap_when_only_competitors_are_mentioned(self):
        items = [_search_result('kw', brands=[_competitor('Rival Inn'), _competitor('Other Co', rank=2)])]

        ideas = _ideas(items)

        assert [(idea['type'], idea['priority']) for idea in ideas] == [('visibility_gap', 'high')]
        assert ideas[0]['description'] == "Your brand doesn't appear but 2 competitors do."
        assert ideas[0]['content_angle'] == 'comprehensive_guide'

    def test_reports_the_competitors_and_providers_behind_a_visibility_gap(self):
        items = [
            _search_result('kw', provider='openai', brands=[_competitor('Rival Inn')], citations=['https://rival.example']),
            _search_result('kw', provider='gemini', brands=[_competitor('Other Co')]),
        ]

        ideas = _ideas(items)

        assert ideas[0]['competitor_brands'] == ['Rival Inn', 'Other Co']
        assert ideas[0]['competitor_urls'] == ['https://rival.example']
        assert sorted(ideas[0]['providers_missing']) == ['gemini', 'openai']

    def test_suggests_a_ranking_improvement_when_first_party_trails_a_competitor(self):
        items = [_search_result('kw', brands=[_competitor(rank=1), _first_party(rank=4)])]

        ideas = _ideas(items)

        assert [(idea['type'], idea['priority']) for idea in ideas] == [('ranking_improvement', 'medium')]
        assert ideas[0]['current_rank'] == 4
        assert ideas[0]['description'] == 'Your brand ranks #4. Create better content to reach #1.'
        assert ideas[0]['content_angle'] == 'differentiation'

    def test_lowers_the_ranking_improvement_priority_when_first_party_is_third(self):
        items = [_search_result('kw', brands=[_competitor(rank=1), _first_party(rank=3)])]

        ideas = _ideas(items)

        assert [(idea['type'], idea['priority']) for idea in ideas] == [('ranking_improvement', 'low')]

    def test_suggests_nothing_for_a_trailing_first_party_when_no_competitor_is_mentioned(self):
        items = [_search_result('kw', brands=[_first_party(rank=5)])]

        ideas = _ideas(items)

        assert ideas == []

    def test_suggests_leadership_maintenance_when_first_party_ranks_in_the_top_two(self):
        items = [
            _search_result('kw', provider='openai', brands=[_first_party(rank=1)], citations=['https://mine.example']),
            _search_result('kw', provider='gemini', brands=[_first_party(rank=2), _competitor(rank=3)], citations=['https://rival.example']),
        ]

        ideas = _ideas(items)

        assert [(idea['type'], idea['priority']) for idea in ideas] == [('leadership_maintenance', 'low')]
        assert ideas[0]['description'] == "You're #1! Create fresh content to stay ahead of 1 competitors."
        assert sorted(ideas[0]['competitor_urls']) == ['https://mine.example', 'https://rival.example']
        assert ideas[0]['content_angle'] == 'thought_leadership'

    def test_flags_a_provider_gap_when_first_party_is_missing_from_one_provider(self):
        items = [
            _search_result('kw', provider='openai', brands=[_first_party(rank=5)]),
            _search_result('kw', provider='gemini'),
        ]

        ideas = _ideas(items)

        assert [(idea['type'], idea['priority']) for idea in ideas] == [('provider_gap', 'medium')]
        assert ideas[0]['title'] == 'Target Gemini for "kw"'
        assert ideas[0]['providers_missing'] == ['gemini']
        assert ideas[0]['providers_present'] == ['openai']

    def test_flags_negative_sentiment_when_first_party_is_mentioned_negatively(self):
        items = [_search_result('kw', brands=[_first_party(rank=5, sentiment='negative')])]

        ideas = _ideas(items)

        assert [(idea['type'], idea['priority']) for idea in ideas] == [('sentiment_improvement', 'high')]
        assert ideas[0]['description'] == 'Your brand has negative sentiment in 1 provider(s). Create positive content.'
        assert ideas[0]['content_angle'] == 'reputation_management'

    def test_analyses_only_the_most_recent_results_for_a_keyword(self):
        items = [
            _search_result('kw', brands=[_first_party(rank=1)], timestamp='2026-04-01T00:00:00Z'),
            _search_result('kw', brands=[_competitor()], timestamp='2026-04-18T00:00:00Z'),
        ]

        ideas = _ideas(items)

        assert [idea['type'] for idea in ideas] == ['visibility_gap']

    def test_skips_rows_with_a_blank_keyword(self):
        items = [_search_result('', brands=[_competitor()]), _search_result('kw', brands=[_competitor()])]

        ideas = _ideas(items)

        assert [idea['keyword'] for idea in ideas] == ['kw']

    def test_orders_ideas_by_priority_then_keyword(self):
        items = [
            _search_result('zeta', brands=[_competitor()]),
            _search_result('alpha', brands=[_first_party(rank=1), _competitor(rank=2)]),
            _search_result('beta', brands=[_competitor()]),
        ]

        ideas = _ideas(items)

        assert [(idea['priority'], idea['keyword']) for idea in ideas] == [
            ('high', 'beta'), ('high', 'zeta'), ('low', 'alpha'),
        ]

    def test_appends_the_seasonal_suggestions_for_the_analysed_keywords(self):
        seasonal = {'type': 'seasonal_content', 'priority': 'medium', 'keyword': 'kw'}
        items = [_search_result('kw', brands=[_first_party(rank=5)])]

        with (
            patch.object(_mod, 'load_recent_search_results', MagicMock(return_value=items)),
            patch.object(_mod, '_get_seasonal_suggestions', MagicMock(return_value=[seasonal])) as suggest,
        ):
            ideas = _mod.generate_content_ideas(_BRAND_CONFIG)

        assert ideas == [seasonal]
        assert suggest.call_args == call(['kw'], _BRAND_CONFIG)

    def test_caps_the_idea_list_at_fifty(self):
        items = [_search_result(f'kw{n:02d}', brands=[_competitor()]) for n in range(60)]

        ideas = _ideas(items)

        assert len(ideas) == 50



# --- generate_content --------------------------------------------------------

_GENERATION_CONFIG = {'tracked_brands': {'first_party': ['Hotel Sol'], 'competitors': []}, 'industry': 'hotels'}
_PREAMBLE = untrusted_input_system_instruction() + '\n\n'
_KEYWORD_TAG = '<keyword>best hotels malaga</keyword>'
_DEFAULT_OPENING = (
    f'Create a comprehensive guide for the keyword {_KEYWORD_TAG} in the <industry>hotels</industry> '
    'industry that positions <brand>Hotel Sol</brand> as an authority.'
)
_MODEL_OUTPUT = (
    'TITLE: Malaga Stays\nMETA: Best stays\n\n'
    'Body text with enough useful detail to remain a valid generated Content Studio draft.\n\n'
    'HEADINGS: Where, When\nPOINTS:\n- Book early'
)


class _ModelCallError(Exception):
    """A non-throttling failure surfaced by the Bedrock client."""


def _crawled_page(domain: str, preview: str = 'Rival body') -> dict:
    """One entry as `get_crawled_content` returns it."""
    return {
        'url': f'https://{domain}/guide',
        'title': f'{domain} guide',
        'content_preview': preview,
        'seo_analysis': {},
        'domain': domain,
    }


def _run_generation(
    idea: dict,
    *,
    config: dict | None = None,
    bedrock: MagicMock | None = None,
    crawled: list[dict] | None = None,
) -> dict:
    """Run `generate_content` with Bedrock and the crawled-content lookup stubbed out."""
    with (
        patch.object(_mod, 'get_crawled_content', MagicMock(return_value=crawled or [])),
        patch.object(_mod, 'invoke_bedrock', bedrock or MagicMock(return_value=_MODEL_OUTPUT)),
        cleared_env('BEDROCK_TIER_GENERATION'),
    ):
        return _mod.generate_content(idea, config or _GENERATION_CONFIG)


def _prompt_for(idea: dict, *, config: dict | None = None, crawled: list[dict] | None = None) -> str:
    """The prompt `generate_content` hands to Bedrock for `idea`."""
    bedrock = MagicMock(return_value='')
    _run_generation(idea, config=config, bedrock=bedrock, crawled=crawled)
    return bedrock.call_args.args[0]


class TestGenerateContentPrompt:
    """What the model is asked, per content angle, with every user-controlled value tag-wrapped."""

    @pytest.mark.parametrize(('content_angle', 'opening'), [
        ('comprehensive_guide', _DEFAULT_OPENING),
        ('not-a-known-angle', _DEFAULT_OPENING),
        (
            'differentiation',
            f'Create a differentiated content piece for the keyword {_KEYWORD_TAG} '
            'that positions <brand>Hotel Sol</brand> uniquely.',
        ),
        (
            'thought_leadership',
            f'Create thought leadership content for the keyword {_KEYWORD_TAG} '
            "to maintain <brand>Hotel Sol</brand>'s #1 position.",
        ),
        (
            'reputation_management',
            f'Create positive, trust-building content for the keyword {_KEYWORD_TAG} '
            "to improve <brand>Hotel Sol</brand>'s sentiment.",
        ),
        ('evergreen', f'Create comprehensive evergreen content for {_KEYWORD_TAG} that will rank year-round.'),
    ])
    def test_opens_with_the_safety_instruction_and_the_brief_for_the_angle(self, content_angle, opening):
        prompt = _prompt_for({**IDEA, 'content_angle': content_angle})

        assert prompt.startswith(_PREAMBLE + opening + '\n')

    def test_addresses_the_missing_providers_in_the_provider_optimization_brief(self):
        idea = {**IDEA, 'content_angle': 'provider_optimization', 'providers_missing': ['gemini', 'claude']}

        prompt = _prompt_for(idea)

        assert prompt.startswith(
            f'{_PREAMBLE}Create content optimized for AI search engines '
            f'(<provider>gemini</provider>, <provider>claude</provider>) for the keyword {_KEYWORD_TAG}.\n'
        )

    def test_ties_the_seasonal_brief_to_the_idea_theme(self):
        prompt = _prompt_for({**IDEA, 'content_angle': 'seasonal', 'seasonal_theme': 'summer'})

        assert prompt.startswith(f'{_PREAMBLE}Create seasonal content for {_KEYWORD_TAG} tied to <theme>summer</theme>.\n')
        assert 'Focus on timeliness and capturing the <theme>summer</theme> moment for <brand>Hotel Sol</brand>.' in prompt

    def test_defaults_the_seasonal_theme_to_the_current_season(self):
        prompt = _prompt_for({**IDEA, 'content_angle': 'seasonal'})

        assert 'tied to <theme>current season</theme>.' in prompt

    def test_centres_the_trending_brief_on_the_idea_topic(self):
        prompt = _prompt_for({**IDEA, 'content_angle': 'trending', 'trending_topic': 'Summer Deals'})

        assert prompt.startswith(
            f'{_PREAMBLE}Create trending content about <topic>Summer Deals</topic> '
            'for the <industry>hotels</industry> industry.\n'
        )

    def test_falls_back_to_the_keyword_as_the_trending_topic(self):
        prompt = _prompt_for({**IDEA, 'content_angle': 'trending'})

        assert 'Create trending content about <topic>best hotels malaga</topic> for the <industry>hotels</industry> industry.' in prompt

    def test_calls_the_brand_your_brand_when_no_first_party_brand_is_configured(self):
        prompt = _prompt_for(IDEA, config={'industry': 'hotels'})

        assert 'positions <brand>your brand</brand> as an authority.' in prompt

    def test_embeds_each_crawled_competitor_page_as_wrapped_context(self):
        prompt = _prompt_for(IDEA, crawled=[_crawled_page('rival.example'), _crawled_page('other.example', preview='')])

        assert (
            '\n\nCompetitor content analysis:\n'
            '\n--- <domain>rival.example</domain> ---\n'
            'Title: <title>rival.example guide</title>\n'
            'Content preview: <content>Rival body</content>...\n'
            '\n--- <domain>other.example</domain> ---\n'
            'Title: <title>other.example guide</title>\n'
            '\n\nGenerate:'
        ) in prompt

    def test_truncates_a_competitor_preview_to_a_thousand_characters(self):
        prompt = _prompt_for(IDEA, crawled=[_crawled_page('rival.example', preview='a' * 1500)])

        assert f'Content preview: <content>{"a" * 1000}</content>...\n' in prompt

    def test_leaves_out_the_competitor_section_when_nothing_was_crawled(self):
        prompt = _prompt_for(IDEA)

        assert 'Competitor content analysis' not in prompt

    def test_places_the_output_language_instruction_before_the_json_contract(self):
        prompt = _prompt_for({**IDEA, 'output_language': 'Spanish'})

        assert (
            '\n\nIMPORTANT: Write ALL content in <language>Spanish</language>. '
            'The title, meta description, body, headings, and key points must all be in '
            f'<language>Spanish</language>.\n\n{CONTENT_OUTPUT_CONTRACT}'
        ) in prompt
        assert prompt.endswith(CONTENT_OUTPUT_CONTRACT)

    @pytest.mark.parametrize('idea', [IDEA, {**IDEA, 'output_language': 'English'}, {**IDEA, 'output_language': ''}])
    def test_adds_no_language_instruction_when_the_output_language_is_english_or_unset(self, idea):
        prompt = _prompt_for(idea)

        assert 'IMPORTANT: Write ALL content' not in prompt
        assert prompt.endswith(CONTENT_OUTPUT_CONTRACT)

    @pytest.mark.parametrize('content_angle', [
        'comprehensive_guide',
        'differentiation',
        'provider_optimization',
        'thought_leadership',
        'reputation_management',
        'seasonal',
        'trending',
        'evergreen',
        'not-a-known-angle',
    ])
    def test_appends_one_exact_json_contract_for_every_content_angle(self, content_angle):
        prompt = _prompt_for({**IDEA, 'content_angle': content_angle})

        assert prompt.endswith(CONTENT_OUTPUT_CONTRACT)
        assert prompt.count(CONTENT_OUTPUT_CONTRACT) == 1

    def test_assembles_the_default_brief_around_the_competitor_context(self):
        prompt = _prompt_for(
            {**IDEA, 'output_language': 'Spanish'},
            crawled=[_crawled_page('rival.example')],
        )

        assert prompt.startswith(
            f'{_PREAMBLE}{_DEFAULT_OPENING}\n\n\n\nCompetitor content analysis:\n'
            '\n--- <domain>rival.example</domain> ---\n'
            'Title: <title>rival.example guide</title>\n'
            'Content preview: <content>Rival body</content>...\n\n\nGenerate:\n'
        )
        assert 'Make it comprehensive, authoritative, and better than competitor content.' in prompt
        assert prompt.endswith(CONTENT_OUTPUT_CONTRACT)


class TestGenerateContentResult:
    """The dict `_process_generation_async` persists, for a successful and a failed model call."""

    def test_returns_the_parsed_content_alongside_the_raw_model_output(self):
        result = _run_generation(IDEA)

        assert result['success'] is True
        assert result['raw_content'] == _MODEL_OUTPUT
        assert result['content']['title'] == 'Malaga Stays'
        assert result['content']['key_points'] == ['Book early']

    def test_reports_the_generation_model_tier_and_the_requested_angle(self):
        result = _run_generation({**IDEA, 'content_angle': 'evergreen'})

        assert result['model'] == 'fast'
        assert result['content_angle'] == 'evergreen'

    def test_defaults_the_content_angle_to_comprehensive_guide(self):
        result = _run_generation({'id': 'idea-1', 'keyword': 'best hotels malaga'})

        assert result['content_angle'] == 'comprehensive_guide'

    def test_counts_the_competitor_pages_that_fed_the_prompt(self):
        result = _run_generation(IDEA, crawled=[_crawled_page('a.example'), _crawled_page('b.example')])

        assert result['competitor_sources_used'] == 2

    def test_asks_bedrock_for_the_generation_role_with_the_content_budget(self):
        bedrock = MagicMock(return_value='')

        _run_generation(IDEA, bedrock=bedrock)

        assert bedrock.call_args.args[1] == ModelRole.GENERATION
        assert bedrock.call_args.kwargs == {'max_tokens': 8000, 'temperature': 0.7}

    def test_reports_throttling_when_bedrock_gives_up_retrying(self):
        result = _run_generation(IDEA, bedrock=MagicMock(side_effect=BedrockInvocationError('throttled')))

        assert result == {
            'success': False,
            'error': 'Too many requests. Please wait a moment and try again.',
            'error_type': 'throttling',
            'content_angle': 'comprehensive_guide',
        }

    @pytest.mark.parametrize(('message', 'error', 'error_type'), [
        (
            'An error occurred (AccessDeniedException) when calling Converse',
            'Access denied to Bedrock model. Check IAM permissions.',
            'access_denied',
        ),
        (
            'ModelTimeoutException: model did not respond',
            'AI model took too long to respond. Please try again with a simpler keyword.',
            'timeout',
        ),
        ('ModelErrorException', 'AI model encountered an error. Please try again.', 'model_error'),
        ('ValidationException: bad input', 'Invalid request to AI model. Please try a different keyword.', 'generation_error'),
        ('ServiceUnavailable', 'AI service temporarily unavailable. Please try again later.', 'generation_error'),
        ('InternalServerError', 'AI service temporarily unavailable. Please try again later.', 'generation_error'),
        ('ResourceNotFoundException', 'AI model not found. Please contact support.', 'generation_error'),
    ])
    def test_translates_aws_error_codes_into_user_facing_messages(self, message, error, error_type):
        result = _run_generation(IDEA, bedrock=MagicMock(side_effect=_ModelCallError(message)))

        assert result == {
            'success': False,
            'error': error,
            'error_type': error_type,
            'content_angle': 'comprehensive_guide',
        }

    def test_prefers_the_access_denied_mapping_when_several_codes_appear(self):
        error = _ModelCallError('ValidationException raised after AccessDeniedException')

        result = _run_generation(IDEA, bedrock=MagicMock(side_effect=error))

        assert result['error_type'] == 'access_denied'

    def test_truncates_an_unrecognised_error_to_two_hundred_characters(self):
        result = _run_generation(IDEA, bedrock=MagicMock(side_effect=_ModelCallError('x' * 250)))

        assert result['error'] == 'Content generation failed: ' + 'x' * 200
        assert result['error_type'] == 'generation_error'



_STRUCTURED_RESPONSE = """Here is your article.
TITLE: Best Hotels in Malaga for Families
META: Family-friendly hotels in Malaga, from beachfront resorts to old-town boutiques.

Malaga rewards families who stay near the sea.

The old town suits short city breaks.
HEADINGS: Where to Stay, When to Go, What It Costs
KEY POINTS:
- Beachfront hotels book out by March
* Old-town hotels are quieter after 10pm
3. Parking is scarce in the centre
"""


class TestParseGeneratedContent:
    def test_extracts_the_title_after_the_first_title_marker(self):
        assert _mod.parse_generated_content(_STRUCTURED_RESPONSE)['title'] == 'Best Hotels in Malaga for Families'

    def test_extracts_the_meta_description_and_caps_it_at_160_characters(self):
        long_meta = 'TITLE: T\nMETA: ' + 'm' * 200 + '\nBody'

        assert _mod.parse_generated_content(long_meta)['meta_description'] == 'm' * 160

    def test_accepts_meta_description_as_the_marker(self):
        assert _mod.parse_generated_content('META_DESCRIPTION: Short and sweet\nBody')['meta_description'] == 'Short and sweet'

    def test_matches_markers_regardless_of_case_and_indentation(self):
        text = '  title: Lower Case Title\n  meta: lower meta\nBody'

        result = _mod.parse_generated_content(text)

        assert (result['title'], result['meta_description']) == ('Lower Case Title', 'lower meta')

    def test_takes_the_body_between_the_meta_line_and_the_headings_marker(self):
        body = _mod.parse_generated_content(_STRUCTURED_RESPONSE)['body']

        assert body == 'Malaga rewards families who stay near the sea.\n\nThe old town suits short city breaks.'

    def test_stops_the_body_at_a_points_marker_when_there_are_no_headings(self):
        text = 'META: m\nFirst paragraph.\nKEY POINTS:\n- one'

        assert _mod.parse_generated_content(text)['body'] == 'First paragraph.'

    def test_falls_back_to_the_whole_text_as_body_when_no_meta_line_exists(self):
        text = 'Just prose, no markers at all.\nSecond line.'

        assert _mod.parse_generated_content(text)['body'] == text

    def test_excludes_markers_when_the_legacy_body_is_empty(self):
        text = 'TITLE: T\nMETA: m\nHEADINGS: A, B'

        assert _mod.parse_generated_content(text)['body'] == ''

    def test_splits_headings_on_commas_and_drops_blank_entries(self):
        headings = _mod.parse_generated_content('HEADINGS: Where to Stay, , When to Go ,')['suggested_headings']

        assert headings == ['Where to Stay', 'When to Go']

    def test_leaves_headings_empty_when_the_marker_has_nothing_after_it(self):
        assert _mod.parse_generated_content('SUGGESTED HEADINGS:\nBody')['suggested_headings'] == []

    def test_collects_key_points_stripping_bullets_and_numbering(self):
        points = _mod.parse_generated_content(_STRUCTURED_RESPONSE)['key_points']

        assert points == [
            'Beachfront hotels book out by March',
            'Old-town hotels are quieter after 10pm',
            'Parking is scarce in the centre',
        ]

    def test_skips_blank_and_marker_only_lines_among_the_key_points(self):
        text = 'KEY POINTS:\n\n- \n- Real point\n   \n'

        assert _mod.parse_generated_content(text)['key_points'] == ['Real point']

    def test_returns_empty_fields_and_the_text_as_body_for_an_unstructured_answer(self):
        result = _mod.parse_generated_content('plain answer')

        assert result == {
            'title': '', 'meta_description': '', 'body': 'plain answer', 'suggested_headings': [], 'key_points': [],
        }



_JSON_BODY = (
    '## Overview\n\nThis complete Markdown body contains enough useful detail '
    'to remain a valid Content Studio draft.'
)
_EMPTY_PARSED_CONTENT = {
    'title': '',
    'meta_description': '',
    'body': '',
    'suggested_headings': [],
    'key_points': [],
}
_VALID_JSON_CONTRACT = {
    'title': 'Fenced title',
    'meta_description': 'Fenced description',
    'body': _JSON_BODY,
    'suggested_headings': ['Overview'],
    'key_points': ['First point'],
}


class TestJsonOutputContractParsing:
    def test_normalizes_exact_fields_when_model_returns_json(self):
        response = json.dumps({
            'title': '  JSON title  ',
            'meta_description': 'm' * 170,
            'body': f'  {_JSON_BODY}  ',
            'suggested_headings': [' Overview ', '', 7],
            'key_points': [' First point ', None, ''],
        })

        result = _mod.parse_generated_content(response)

        assert result == {
            'title': 'JSON title',
            'meta_description': 'm' * 160,
            'body': _JSON_BODY,
            'suggested_headings': ['Overview'],
            'key_points': ['First point'],
        }

    def test_parses_exact_fields_when_json_is_wrapped_in_markdown_fence(self):
        response = f'```json\n{json.dumps(_VALID_JSON_CONTRACT)}\n```'

        result = _mod.parse_generated_content(response)

        assert result == _VALID_JSON_CONTRACT

    def test_normalizes_contract_when_generic_fence_consumes_the_response(self):
        response = f'```\n{json.dumps(_VALID_JSON_CONTRACT)}\n```'

        result = _mod.parse_generated_content(response)

        assert result == _VALID_JSON_CONTRACT

    def test_normalizes_contract_when_common_preamble_precedes_json_fence(self):
        response = f'Here is the JSON:\n```json\n{json.dumps(_VALID_JSON_CONTRACT)}\n```'

        result = _mod.parse_generated_content(response)

        assert result == _VALID_JSON_CONTRACT

    def test_returns_empty_content_when_the_whole_json_object_is_unrelated(self):
        response = json.dumps({
            'schema': 'article',
            'properties': {'headline': 'A schema example'},
        })

        result = _mod.parse_generated_content(response)

        assert result == _EMPTY_PARSED_CONTENT

    def test_returns_empty_content_when_whole_json_has_metadata_without_body(self):
        response = json.dumps({'title': 'Metadata is not a draft'})

        result = _mod.parse_generated_content(response)

        assert result == _EMPTY_PARSED_CONTENT

    def test_returns_empty_content_when_body_json_has_a_non_contract_field(self):
        response = json.dumps({
            'body': _JSON_BODY,
            'debug': 'Unexpected model metadata',
        })

        result = _mod.parse_generated_content(response)

        assert result == _EMPTY_PARSED_CONTENT


class TestLegacyOutputFallback:
    def test_preserves_entire_markdown_when_title_json_is_embedded_between_prose(self):
        response = """# JSON authoring notes

The model may return this metadata example:
{"title": "Example title"}

Keep the explanation after the sample as part of the document."""

        result = _mod.parse_generated_content(response)

        assert result == (_EMPTY_PARSED_CONTENT | {'body': response})

    def test_preserves_entire_markdown_when_long_body_json_is_an_embedded_code_sample(self):
        embedded_contract = json.dumps({'body': _JSON_BODY})
        response = f"""# Content contract example

Use this sample when documenting the response format:
```json
{embedded_contract}
```

This explanation after the sample must also remain in the document."""

        result = _mod.parse_generated_content(response)

        assert result == (_EMPTY_PARSED_CONTENT | {'body': response})

    def test_preserves_markdown_body_when_it_contains_unrelated_embedded_json(self):
        response = f"""# Malaga hotel guide

{_JSON_BODY}

```json
{{"tracking": {{"enabled": true}}}}
```

Use these recommendations when planning a family stay."""

        result = _mod.parse_generated_content(response)

        assert result == (_EMPTY_PARSED_CONTENT | {'body': response})

    def test_parses_observed_bold_markdown_response_without_markers_or_preamble_in_body(self):
        response = f"""Here is the requested draft.
**TITLE:** Bold title
**META:** Bold description

{_JSON_BODY}

**HEADINGS:** Overview, Details
**POINTS:**
- First point
- Second point"""

        result = _mod.parse_generated_content(response)

        assert result == {
            'title': 'Bold title',
            'meta_description': 'Bold description',
            'body': _JSON_BODY,
            'suggested_headings': ['Overview', 'Details'],
            'key_points': ['First point', 'Second point'],
        }

    def test_parses_underscored_markers_without_markers_in_body(self):
        response = f"""Preamble that must not become content.
__TITLE:__ Underscored title
_META:_ Underscored description

{_JSON_BODY}

__HEADINGS:__ Overview, Details
_POINTS:_ First point, Second point"""

        result = _mod.parse_generated_content(response)

        assert result == {
            'title': 'Underscored title',
            'meta_description': 'Underscored description',
            'body': _JSON_BODY,
            'suggested_headings': ['Overview', 'Details'],
            'key_points': ['First point', 'Second point'],
        }


def _invalid_output_result(raw_content: str) -> dict:
    """Return the exact failed-generation contract for unusable model output."""
    return {
        'success': False,
        'error': 'The AI response did not contain a usable content draft. Please try again.',
        'error_type': 'invalid_output',
        'content_angle': 'comprehensive_guide',
        'raw_content': raw_content,
    }


class TestGeneratedOutputValidation:
    def test_keeps_body_only_contract_json_generated_with_structured_metadata_warning(self):
        raw_content = json.dumps({'body': _JSON_BODY})

        result = _run_generation(IDEA, bedrock=MagicMock(return_value=raw_content))

        assert result['success'] is True
        assert result['content']['body'] == _JSON_BODY
        assert result['content_warning'] == {
            'code': 'incomplete_metadata',
            'message': 'This draft is usable, but some generated metadata is incomplete.',
            'missing_fields': [
                'title', 'meta_description', 'suggested_headings', 'key_points'
            ],
        }
        assert result['raw_content'] == raw_content

    def test_rejects_truncated_json_looking_output_instead_of_using_it_as_the_body(self):
        raw_content = (
            '{"title": "Truncated draft", "body": "## Overview\\n\\n'
            'This incomplete response has enough readable text to pass the body length threshold.'
        )

        result = _run_generation(IDEA, bedrock=MagicMock(return_value=raw_content))

        assert result == _invalid_output_result(raw_content)

    def test_rejects_output_when_preamble_precedes_truncated_json_fence(self):
        raw_content = (
            'Here is the JSON:\n```json\n'
            '{"title": "Truncated draft", "body": "## Overview\\n\\n'
            'This fenced response was truncated despite containing enough readable text.'
        )

        result = _run_generation(IDEA, bedrock=MagicMock(return_value=raw_content))

        assert result == _invalid_output_result(raw_content)

    def test_rejects_output_when_complete_contract_has_an_unclosed_json_fence(self):
        raw_content = f'```json\n{json.dumps(_VALID_JSON_CONTRACT)}'

        result = _run_generation(IDEA, bedrock=MagicMock(return_value=raw_content))

        assert result == _invalid_output_result(raw_content)

    def test_rejects_output_when_raw_contract_json_has_trailing_prose(self):
        raw_content = json.dumps({'body': _JSON_BODY}) + '\nI hope this draft helps.'

        result = _run_generation(IDEA, bedrock=MagicMock(return_value=raw_content))

        assert result == _invalid_output_result(raw_content)

    def test_rejects_a_whole_unrelated_json_object_instead_of_using_it_as_the_body(self):
        raw_content = json.dumps({
            'article_schema': 'This unrelated value is deliberately long enough to look useful.',
            'sections': ['Overview', 'Recommendations'],
        })

        result = _run_generation(IDEA, bedrock=MagicMock(return_value=raw_content))

        assert result == _invalid_output_result(raw_content)

    def test_fails_generation_and_preserves_raw_content_when_body_is_unusable(self):
        raw_content = 'TITLE: Empty draft\nMETA: Missing body\nHEADINGS: Intro\nPOINTS:\n- None'

        result = _run_generation(IDEA, bedrock=MagicMock(return_value=raw_content))

        assert result == _invalid_output_result(raw_content)

    def test_persists_structured_warning_with_generated_content(self):
        table = fake_table()
        warning = {
            'code': 'incomplete_metadata',
            'message': 'This draft is usable, but some generated metadata is incomplete.',
            'missing_fields': ['title'],
        }
        generation_result = {
            'content': {'body': _JSON_BODY},
            'raw_content': _JSON_BODY,
            'model': 'fast',
            'competitor_sources_used': 0,
            'content_warning': warning,
        }

        with patch.object(_mod, 'dynamodb', fake_dynamodb_resource(table)):
            _mod.update_content_status('content-1', 'generated', generation_result)

        values = table.update_item.call_args.kwargs['ExpressionAttributeValues']
        assert values[':content_warning'] == warning

    def test_persists_raw_content_when_unusable_output_marks_generation_failed(self):
        table = fake_table()

        with patch.object(_mod, 'dynamodb', fake_dynamodb_resource(table)):
            _mod.update_content_status(
                'content-1',
                'failed',
                {'error': 'Invalid output', 'raw_content': 'raw invalid response'},
            )

        values = table.update_item.call_args.kwargs['ExpressionAttributeValues']
        assert values[':raw'] == 'raw invalid response'

    def test_reports_content_present_when_generated_title_is_missing_but_body_exists(self):
        row = {
            'id': 'content-1',
            'status': 'generated',
            'keyword': 'keyword',
            'generated_content': {'title': ' ', 'body': _JSON_BODY},
            'content_warning': {
                'code': 'incomplete_metadata',
                'message': 'Incomplete metadata',
                'missing_fields': ['title'],
            },
        }
        event = {
            'path': '/content-studio/status/content-1',
            'pathParameters': {'id': 'content-1'},
        }

        with patch.object(_mod, 'get_content_by_id', return_value=row):
            response = _mod._get_content_status(event, None)

        body = json.loads(response['body'])
        assert body['has_content'] is True
        assert body['content_warning'] == row['content_warning']
