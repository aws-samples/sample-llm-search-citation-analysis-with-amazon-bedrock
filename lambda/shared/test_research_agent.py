"""
Tests for shared.research_agent: agent config, step assignment, prompts and
the schema checks applied to the planner / evaluator / selection answers.
"""

from __future__ import annotations

from shared.research_agent import (
    AGENT_MAX_QUERIES_PER_ROUND,
    BUILTIN_TEMPLATE_ID,
    DEFAULT_SYSTEM_PROMPT,
    assign_steps,
    build_agent_config,
    build_evaluate_prompt,
    build_plan_prompt,
    build_search_prompt,
    build_selection_prompt,
    builtin_template,
    fallback_selection,
    parse_evaluation,
    parse_plan,
    parse_queries,
    parse_selection,
    planned_query_texts,
    step_plan_fields,
)


def _config(**overrides) -> dict:
    base = build_agent_config(
        seed='Hotel Gran Marino',
        country='ES',
        language='es',
        dimensions=['destination', 'audience', 'bogus'],
        instruction='also expand by events',
        target_count=60,
        max_rounds=2,
        group_id=None,
    )
    return {**base, **overrides}


_QUERIES = [
    {'query': 'hoteles en coruña centro', 'dimension': 'destination', 'rationale': 'core demand'},
    {'query': 'hotel familiar coruña', 'dimension': 'audience', 'rationale': 'families'},
    {'query': 'hotel cerca torre de hercules', 'dimension': 'points_of_interest', 'rationale': 'landmark'},
]


class TestBuildAgentConfig:
    def test_keeps_only_known_dimensions_in_form_order(self):
        assert _config()['dimensions'] == ['destination', 'audience']

    def test_lowercases_country_and_language_codes(self):
        config = _config()
        assert (config['country'], config['language']) == ('es', 'es')

    def test_stores_no_group_when_none_was_chosen(self):
        assert _config()['group_id'] is None


class TestBuiltinTemplate:
    def test_is_read_only_and_carries_the_default_prompt(self):
        template = builtin_template()
        assert (template['id'], template['builtin'], template['system_prompt']) == (BUILTIN_TEMPLATE_ID, True, DEFAULT_SYSTEM_PROMPT)


class TestAssignSteps:
    def test_rotates_queries_across_the_configured_providers(self):
        steps = assign_steps(_QUERIES, ['perplexity', 'openai'], 1, with_signals=False)

        assert list(steps) == ['r1-q1-perplexity', 'r1-q2-openai', 'r1-q3-perplexity']

    def test_each_step_keeps_its_planned_query_dimension_and_round(self):
        steps = assign_steps(_QUERIES, ['openai'], 2, with_signals=False)

        assert steps['r2-q2-openai'] == {
            'provider': 'openai', 'status': 'pending', 'round': 2,
            'query': 'hotel familiar coruña', 'dimension': 'audience', 'rationale': 'families',
        }

    def test_adds_one_signals_step_per_round_carrying_every_query(self):
        steps = assign_steps(_QUERIES, ['openai'], 1, with_signals=True)

        assert steps['r1-signals-serpapi'] == {
            'provider': 'serpapi', 'status': 'pending', 'round': 1,
            'queries': [
                {'query': 'hoteles en coruña centro', 'dimension': 'destination'},
                {'query': 'hotel familiar coruña', 'dimension': 'audience'},
                {'query': 'hotel cerca torre de hercules', 'dimension': 'points_of_interest'},
            ],
        }

    def test_no_signals_step_without_queries(self):
        assert assign_steps([], ['openai'], 1, with_signals=True) == {}


class TestStepPlanFields:
    def test_keeps_only_the_planning_attributes(self):
        step = {'provider': 'openai', 'status': 'failed', 'round': 1, 'query': 'q', 'dimension': 'audience', 'rationale': 'r', 'keywords': []}

        assert step_plan_fields(step) == {'round': 1, 'query': 'q', 'dimension': 'audience', 'rationale': 'r'}


class TestPrompts:
    def test_plan_prompt_wraps_the_seed_and_instruction_as_untrusted_input(self):
        prompt = build_plan_prompt(_config())

        assert '<hotel>Hotel Gran Marino</hotel>' in prompt
        assert '<instruction>also expand by events</instruction>' in prompt

    def test_plan_prompt_lists_only_the_requested_dimensions(self):
        prompt = build_plan_prompt(_config())

        assert '- destination:' in prompt
        assert '- audience:' in prompt
        assert '- trip_type:' not in prompt

    def test_search_prompt_wraps_the_query_and_names_the_dimension(self):
        prompt = build_search_prompt(_config(), 'hotel familiar coruña', 'audience')

        assert '<query>hotel familiar coruña</query>' in prompt
        assert 'who is travelling' in prompt

    def test_evaluate_prompt_lists_candidates_with_their_sources(self):
        candidates = [{'keyword': 'hotel coruña playa', 'intent': 'commercial', 'competition': 'high', 'relevance': 8, 'dimension': 'destination', 'providers': ['openai', 'serpapi']}]

        prompt = build_evaluate_prompt(_config(), 1, candidates)

        assert '<kw>hotel coruña playa</kw> | dimension=destination | intent=commercial | competition=high | relevance=8 | sources=openai,serpapi' in prompt
        assert 'Round 1 of at most 2 has finished' in prompt

    def test_selection_prompt_states_the_target_count(self):
        prompt = build_selection_prompt(_config(target_count=45), [])

        assert 'at most 45 keywords' in prompt


class TestParseQueries:
    def test_caps_at_the_per_round_maximum(self):
        raw = [{'query': f'query {index}', 'dimension': 'destination'} for index in range(20)]

        assert len(parse_queries(raw, ['destination'])) == AGENT_MAX_QUERIES_PER_ROUND

    def test_drops_duplicates_and_excluded_queries_case_insensitively(self):
        raw = [{'query': 'Hotel Coruña'}, {'query': 'hotel coruña'}, {'query': 'hotel vigo'}]

        queries = parse_queries(raw, ['destination'], exclude={'hotel vigo'})

        assert [query['query'] for query in queries] == ['Hotel Coruña']

    def test_maps_unknown_dimensions_to_other(self):
        assert parse_queries([{'query': 'q', 'dimension': 'weather'}], ['destination'])[0]['dimension'] == 'other'

    def test_accepts_dimension_spelled_with_spaces_or_dashes(self):
        assert parse_queries([{'query': 'q', 'dimension': 'Points of interest'}], ['points_of_interest'])[0]['dimension'] == 'points_of_interest'

    def test_ignores_entries_without_a_query_string(self):
        assert parse_queries([{'dimension': 'destination'}, 'text', {'query': '   '}], ['destination']) == []


class TestParsePlan:
    def test_returns_strategy_and_normalised_queries(self):
        text = '```json\n{"strategy": "Cover destination first", "queries": [{"query": "hoteles coruña", "dimension": "destination", "rationale": "core"}]}\n```'

        assert parse_plan(text, _config()) == {
            'strategy': 'Cover destination first',
            'queries': [{'query': 'hoteles coruña', 'dimension': 'destination', 'rationale': 'core'}],
        }

    def test_none_when_the_model_returns_no_queries(self):
        assert parse_plan('{"strategy": "nothing", "queries": []}', _config()) is None

    def test_none_when_the_answer_is_not_json(self):
        assert parse_plan('I cannot help with that.', _config()) is None


class TestParseEvaluation:
    def test_continue_keeps_the_new_queries(self):
        text = '{"assessment": "thin on audience", "decision": "continue", "reason": "more to find", "next_queries": [{"query": "hotel coruña con niños", "dimension": "audience"}]}'

        evaluation = parse_evaluation(text, _config(), exclude_queries=set())

        assert evaluation['decision'] == 'continue'
        assert evaluation['next_queries'] == [{'query': 'hotel coruña con niños', 'dimension': 'audience', 'rationale': ''}]

    def test_continue_without_new_queries_becomes_stop(self):
        text = '{"decision": "continue", "reason": "x", "next_queries": [{"query": "hoteles coruña"}]}'

        evaluation = parse_evaluation(text, _config(), exclude_queries={'hoteles coruña'})

        assert (evaluation['decision'], evaluation['next_queries']) == ('stop', [])

    def test_stop_discards_any_queries(self):
        text = '{"decision": "STOP", "reason": "saturated", "next_queries": [{"query": "leftover"}]}'

        evaluation = parse_evaluation(text, _config(), exclude_queries=set())

        assert (evaluation['decision'], evaluation['next_queries'], evaluation['reason']) == ('stop', [], 'saturated')

    def test_none_when_the_answer_is_not_an_object(self):
        assert parse_evaluation('[1, 2]', _config(), exclude_queries=set()) is None


class TestParseSelection:
    _CANDIDATES = [
        {'keyword': 'hotel coruña playa', 'intent': 'commercial', 'competition': 'high', 'relevance': 8, 'providers': ['openai']},
        {'keyword': 'hotel coruña spa', 'intent': '', 'competition': '', 'relevance': 5, 'providers': ['serpapi']},
    ]

    def test_enriches_selected_keywords_with_the_candidate_providers(self):
        text = '[{"keyword": "Hotel Coruña Playa", "dimension": "destination", "intent": "transactional", "competition": "high", "relevance": 9, "rationale": "beachfront demand"}]'

        proposal = parse_selection(text, _config(), self._CANDIDATES)

        assert proposal == [{
            'keyword': 'Hotel Coruña Playa', 'dimension': 'destination', 'intent': 'transactional',
            'competition': 'high', 'relevance': 9.0, 'rationale': 'beachfront demand', 'providers': ['openai'],
        }]

    def test_fills_intent_and_competition_from_the_candidate_when_the_model_omits_them(self):
        text = '[{"keyword": "hotel coruña spa", "dimension": "hotel_attributes"}]'

        proposal = parse_selection(text, _config(), self._CANDIDATES)

        assert (proposal[0]['intent'], proposal[0]['competition'], proposal[0]['relevance']) == ('informational', 'medium', 5.0)

    def test_caps_the_proposal_at_the_target_count(self):
        text = '[' + ','.join(f'{{"keyword": "kw {index}"}}' for index in range(30)) + ']'

        assert len(parse_selection(text, _config(target_count=12), [])) == 12

    def test_deduplicates_on_the_canonical_keyword(self):
        text = '[{"keyword": "Hotel Coruña"}, {"keyword": "hotel  coruña"}]'

        assert len(parse_selection(text, _config(), [])) == 1

    def test_clamps_relevance_into_zero_to_ten(self):
        text = '[{"keyword": "a", "relevance": 42}, {"keyword": "b", "relevance": -3}]'

        assert [entry['relevance'] for entry in parse_selection(text, _config(), [])] == [10.0, 0.0]

    def test_none_when_nothing_usable_was_returned(self):
        assert parse_selection('[]', _config(), self._CANDIDATES) is None


class TestFallbackSelection:
    def test_takes_the_top_candidates_in_order_up_to_the_target(self):
        candidates = [{'keyword': f'kw {index}', 'relevance': 10 - index, 'providers': ['gemini']} for index in range(5)]

        proposal = fallback_selection(_config(target_count=10), candidates)

        assert [entry['keyword'] for entry in proposal] == ['kw 0', 'kw 1', 'kw 2', 'kw 3', 'kw 4']
        assert proposal[0] == {'keyword': 'kw 0', 'dimension': 'other', 'intent': 'informational', 'competition': 'medium', 'relevance': 10.0, 'rationale': '', 'providers': ['gemini']}


class TestPlannedQueryTexts:
    def test_collects_every_planned_query_casefolded(self):
        job = {'rounds': [{'queries': [{'query': 'Hotel Coruña'}]}, {'queries': [{'query': 'hotel vigo'}]}]}

        assert planned_query_texts(job) == {'hotel coruña', 'hotel vigo'}

    def test_empty_without_rounds(self):
        assert planned_query_texts({}) == set()
