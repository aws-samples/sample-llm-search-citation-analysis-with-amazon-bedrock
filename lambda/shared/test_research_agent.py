"""
Tests for shared.research_agent: agent config, step assignment, prompts and
the schema checks applied to the planner / evaluator / selection answers.
"""

from __future__ import annotations

import pytest

from shared.research_agent import (
    AGENT_DEFAULT_TRACKING_COUNT,
    AGENT_MAX_QUERIES_PER_ROUND,
    BUILTIN_TEMPLATE_ID,
    BUILTIN_TEMPLATES,
    DEFAULT_SYSTEM_PROMPT,
    LEGACY_DIMENSION_CATALOG,
    MAX_TEMPLATE_DIMENSIONS,
    OTHER_DIMENSION,
    RESTAURANT_TEMPLATE,
    assign_steps,
    build_agent_config,
    build_evaluate_prompt,
    build_plan_prompt,
    build_search_prompt,
    build_selection_prompt,
    builtin_template,
    builtin_templates,
    config_tracking_count,
    fallback_selection,
    mark_tracking_subset,
    normalise_dimensions,
    parse_evaluation,
    parse_plan,
    parse_queries,
    parse_selection,
    planned_query_texts,
    step_plan_fields,
    validate_noun,
)

HOTEL_PROFILE = {
    'subject': 'hotel',
    'audience': 'travellers',
    'dimension_catalog': LEGACY_DIMENSION_CATALOG,
}


def _config(**overrides) -> dict:
    target_count = overrides.pop('target_count', 60)
    tracking_count = overrides.pop('tracking_count', None)
    base = build_agent_config(
        seed='Hotel Gran Marino',
        country='ES',
        language='es',
        dimensions=['destination', 'audience', 'bogus'],
        instruction='also expand by events',
        target_count=target_count,
        max_rounds=2,
        group_id=None,
        tracking_count=tracking_count,
        **HOTEL_PROFILE,
    )
    return {**base, **overrides}


def _restaurant_config() -> dict:
    return build_agent_config(
        seed='Casa Lucio',
        country='es',
        language='es',
        dimensions=['cuisine', 'occasion'],
        instruction='',
        target_count=40,
        max_rounds=1,
        group_id=None,
        subject=RESTAURANT_TEMPLATE.subject,
        audience=RESTAURANT_TEMPLATE.audience,
        dimension_catalog=[dimension.to_dict() for dimension in RESTAURANT_TEMPLATE.dimensions],
    )


def _legacy_config() -> dict:
    """An agent row written before profile and tracking configuration existed."""
    config = _config()
    legacy_fields = ('subject', 'audience', 'dimension_catalog', 'tracking_count')
    return {key: value for key, value in config.items() if key not in legacy_fields}


_QUERIES = [
    {'query': 'hoteles en coruña centro', 'dimension': 'destination', 'rationale': 'core demand'},
    {'query': 'hotel familiar coruña', 'dimension': 'audience', 'rationale': 'families'},
    {'query': 'hotel cerca torre de hercules', 'dimension': 'points_of_interest', 'rationale': 'landmark'},
]


class TestBuildAgentConfig:
    def test_keeps_only_catalogue_dimensions_in_catalogue_order(self):
        assert _config()['dimensions'] == ['destination', 'audience']

    def test_lowercases_country_and_language_codes(self):
        config = _config()
        assert (config['country'], config['language']) == ('es', 'es')

    def test_stores_no_group_when_none_was_chosen(self):
        assert _config()['group_id'] is None

    def test_stores_the_default_tracking_count_when_target_allows_it(self):
        assert _config()['tracking_count'] == AGENT_DEFAULT_TRACKING_COUNT

    def test_caps_an_omitted_tracking_count_at_a_shorter_target(self):
        assert _config(target_count=10)['tracking_count'] == 10

    def test_snapshots_the_template_profile(self):
        config = _restaurant_config()

        assert (config['subject'], config['audience']) == ('restaurant', 'diners')
        assert [dimension['id'] for dimension in config['dimension_catalog']] == [
            'cuisine', 'location', 'occasion', 'menu_attributes', 'experience', 'audience', 'service',
        ]


class TestBuiltinTemplates:
    def test_hotels_keeps_the_legacy_id_and_the_verbatim_default_prompt(self):
        template = builtin_template()
        assert (template['id'], template['builtin'], template['system_prompt']) == (BUILTIN_TEMPLATE_ID, True, DEFAULT_SYSTEM_PROMPT)

    def test_lists_the_five_industries_hotels_first(self):
        assert [template['id'] for template in builtin_templates()] == [
            'builtin-default', 'builtin-restaurants', 'builtin-cafes', 'builtin-retail', 'builtin-generic',
        ]

    def test_every_builtin_has_a_well_formed_profile(self):
        for template in BUILTIN_TEMPLATES:
            view = template.to_view()
            cleaned = normalise_dimensions(view['dimensions'])
            assert cleaned == view['dimensions'], template.id
            assert validate_noun(view['subject'], 'subject') is None, template.id
            assert validate_noun(view['audience'], 'audience') is None, template.id

    def test_every_builtin_prompt_names_its_subject_and_the_shared_rules(self):
        for template in BUILTIN_TEMPLATES:
            assert f'around ONE {template.subject}' in template.system_prompt, template.id
            assert 'Always answer with the exact JSON shape you are asked for and nothing else.' in template.system_prompt, template.id

    def test_unknown_builtin_id_is_none(self):
        assert builtin_template('builtin-airlines') is None


class TestNormaliseDimensions:
    def test_cleans_ids_and_trims_text(self):
        cleaned = normalise_dimensions([
            {'id': ' Menu ', 'label': ' Menu & drinks ', 'description': ' coffee styles '},
            {'id': 'location', 'label': 'Location'},
        ])

        assert cleaned == [
            {'id': 'menu', 'label': 'Menu & drinks', 'description': 'coffee styles'},
            {'id': 'location', 'label': 'Location', 'description': ''},
        ]

    def test_rejects_fewer_than_two_dimensions(self):
        assert normalise_dimensions([{'id': 'menu', 'label': 'Menu'}]) == 'A template needs at least 2 dimensions'

    def test_rejects_more_than_the_maximum(self):
        too_many = [{'id': f'd{index}', 'label': 'D'} for index in range(MAX_TEMPLATE_DIMENSIONS + 1)]

        assert normalise_dimensions(too_many) == f'A template can have at most {MAX_TEMPLATE_DIMENSIONS} dimensions'

    def test_rejects_a_malformed_id(self):
        result = normalise_dimensions([{'id': '1st', 'label': 'First'}, {'id': 'ok', 'label': 'Ok'}])

        assert result == "Dimension id '1st' must be 2-40 characters: a letter, then letters, digits or underscores"

    def test_rejects_the_reserved_other_id(self):
        result = normalise_dimensions([{'id': 'other', 'label': 'Other'}, {'id': 'ok', 'label': 'Ok'}])

        assert result == "'other' is reserved for keywords that fit no dimension"

    def test_rejects_a_repeated_id(self):
        result = normalise_dimensions([{'id': 'menu', 'label': 'Menu'}, {'id': 'MENU', 'label': 'Menu again'}])

        assert result == "Dimension id 'menu' is repeated"

    def test_rejects_a_missing_label(self):
        result = normalise_dimensions([{'id': 'menu'}, {'id': 'ok', 'label': 'Ok'}])

        assert result == "Dimension 'menu' needs a label of at most 60 characters"

    def test_rejects_a_non_list(self):
        assert normalise_dimensions({'id': 'menu'}) == 'dimensions must be a list'


class TestValidateNoun:
    def test_accepts_accented_words_and_short_phrases(self):
        assert validate_noun('café', 'subject') is None
        assert validate_noun('coffee drinkers', 'audience') is None

    def test_rejects_punctuation_digits_and_empty_values(self):
        message = 'subject must be a word or short phrase of 2 to 40 letters'

        assert validate_noun('<hotel>', 'subject') == message
        assert validate_noun('42', 'subject') == message
        assert validate_noun('', 'subject') == message


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

        assert 'Hotel / seed: <subject>Hotel Gran Marino</subject>' in prompt
        assert '<instruction>also expand by events</instruction>' in prompt

    def test_plan_prompt_lists_only_the_requested_dimensions(self):
        prompt = build_plan_prompt(_config())

        assert '- destination:' in prompt
        assert '- audience:' in prompt
        assert '- trip_type:' not in prompt

    def test_plan_prompt_speaks_in_the_template_nouns(self):
        prompt = build_plan_prompt(_restaurant_config())

        assert 'Restaurant / seed: <subject>Casa Lucio</subject>' in prompt
        assert 'discover what diners search for around this restaurant' in prompt
        assert '- cuisine: the cuisine, signature dishes' in prompt
        assert '"dimension": "one of: cuisine, occasion, other"' in prompt

    def test_legacy_config_still_reads_as_a_hotel_brief(self):
        legacy = build_plan_prompt(_legacy_config())

        assert legacy == build_plan_prompt(_config())

    def test_search_prompt_wraps_the_query_and_names_the_dimension(self):
        prompt = build_search_prompt(_config(), 'hotel familiar coruña', 'audience')

        assert '<query>hotel familiar coruña</query>' in prompt
        assert 'who is travelling' in prompt
        assert 'You are researching search demand for a hotel.' in prompt

    def test_search_prompt_describes_an_unknown_dimension_generically(self):
        prompt = build_search_prompt(_restaurant_config(), 'mejor cocido madrid', 'trip_type')

        assert 'Dimension of this query: the aspect the query is about' in prompt
        assert 'keywords that diners actually search for' in prompt

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

    def test_maps_a_hotel_dimension_the_run_did_not_request_to_other(self):
        assert parse_queries([{'query': 'q', 'dimension': 'trip_type'}], ['destination'])[0]['dimension'] == OTHER_DIMENSION

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


def _tracking_entry(
    keyword: str,
    *,
    relevance: float = 5,
    intent: str = 'informational',
    competition: str = 'medium',
    dimension: str = 'other',
    providers: list[str] | None = None,
) -> dict:
    return {
        'keyword': keyword,
        'dimension': dimension,
        'intent': intent,
        'competition': competition,
        'relevance': relevance,
        'rationale': '',
        'providers': providers or ['openai'],
    }


class TestMarkTrackingSubset:
    def test_marks_exactly_the_configured_count_when_the_proposal_is_longer(self):
        proposal = [
            _tracking_entry('book hotel coruña', relevance=9, intent='transactional'),
            _tracking_entry('best hotel coruña', relevance=8, intent='commercial'),
            _tracking_entry('what to do coruña', relevance=7),
        ]

        marked = mark_tracking_subset(proposal, _config(tracking_count=2))

        assert [entry['tracking'] for entry in marked] == [True, True, False]
        assert sum(entry['tracking'] for entry in marked) == 2

    def test_marks_every_entry_when_the_proposal_is_shorter_than_the_count(self):
        proposal = [_tracking_entry('one'), _tracking_entry('two')]

        marked = mark_tracking_subset(proposal, _config(tracking_count=15))

        assert [entry['tracking'] for entry in marked] == [True, True]

    def test_includes_the_exact_normalized_seed_before_a_higher_scored_candidate(self):
        proposal = [
            _tracking_entry('  HOTEL   GRAN MARINO ', relevance=1),
            _tracking_entry('book hotel coruña', relevance=10, intent='transactional'),
        ]

        marked = mark_tracking_subset(proposal, _config(tracking_count=1))

        assert [entry['tracking'] for entry in marked] == [True, False]
        assert marked[0]['tracking_reason'].startswith('Exact seed match;')

    def test_reserves_the_best_candidate_in_each_configured_dimension_when_count_permits(self):
        proposal = [
            _tracking_entry('seed hotel', relevance=2, dimension='destination'),
            _tracking_entry('weak family hotel', relevance=3, dimension='audience'),
            _tracking_entry('best family hotel', relevance=9, dimension='audience'),
            _tracking_entry('weekend hotel', relevance=7, dimension='trip_type'),
            _tracking_entry('highest other', relevance=10),
        ]
        config = _config(
            seed='seed hotel',
            dimensions=['destination', 'audience', 'trip_type'],
            tracking_count=3,
        )

        marked = mark_tracking_subset(proposal, config)

        assert [entry['keyword'] for entry in marked if entry['tracking']] == [
            'seed hotel', 'best family hotel', 'weekend hotel',
        ]

    def test_balances_conversion_and_informational_intents_before_score_fill(self):
        proposal = [
            *[_tracking_entry(f'convert {index}', relevance=5, intent='commercial') for index in range(5)],
            *[_tracking_entry(f'inform {index}', relevance=4) for index in range(2)],
            _tracking_entry('navigate first', relevance=10, intent='navigational'),
            _tracking_entry('navigate second', relevance=9, intent='navigational'),
        ]

        marked = mark_tracking_subset(proposal, _config(dimensions=['destination'], tracking_count=8))
        selected_intents = [entry['intent'] for entry in marked if entry['tracking']]

        assert selected_intents == [
            'commercial', 'commercial', 'commercial', 'commercial', 'commercial',
            'informational', 'informational', 'navigational',
        ]

    def test_proposal_order_breaks_equal_source_signal_scores(self):
        proposal = [
            _tracking_entry('provider agreement', relevance=8, providers=['openai', 'gemini']),
            _tracking_entry('google signals', relevance=8, providers=['serpapi']),
            _tracking_entry('single provider', relevance=8, providers=['openai']),
        ]

        marked = mark_tracking_subset(proposal, _config(dimensions=['destination'], tracking_count=1))

        assert [entry['tracking_score'] for entry in marked] == [803.0, 803.0, 802.0]
        assert [entry['tracking'] for entry in marked] == [True, False, False]
        assert marked[0]['tracking_reason'] == 'Relevance 8/10; informational intent; 2-provider agreement.'
        assert marked[1]['tracking_reason'] == 'Relevance 8/10; informational intent; 1 provider; Google suggestion signals.'

    def test_does_not_penalize_high_competition_when_available_signals_tie(self):
        proposal = [
            _tracking_entry('competitive term', relevance=8, competition='high'),
            _tracking_entry('easy term', relevance=8, competition='low'),
        ]

        marked = mark_tracking_subset(proposal, _config(dimensions=['destination'], tracking_count=1))

        assert [entry['tracking_score'] for entry in marked] == [802.0, 802.0]
        assert [entry['tracking'] for entry in marked] == [True, False]

    @pytest.mark.parametrize(('config', 'expected'), [
        ({'target_count': 9}, 9),
        ({'target_count': 60, 'tracking_count': 'invalid'}, 15),
    ])
    def test_returns_target_bounded_default_when_tracking_count_is_unusable(
        self, config, expected
    ):
        assert config_tracking_count(config) == expected


class TestPlannedQueryTexts:
    def test_collects_every_planned_query_casefolded(self):
        job = {'rounds': [{'queries': [{'query': 'Hotel Coruña'}]}, {'queries': [{'query': 'hotel vigo'}]}]}

        assert planned_query_texts(job) == {'hotel coruña', 'hotel vigo'}

    def test_empty_without_rounds(self):
        assert planned_query_texts({}) == set()
