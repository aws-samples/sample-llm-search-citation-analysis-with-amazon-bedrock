"""
Tests for shared.utils.recommendation_id — the deterministic hash used
to track recommendation status across list-regenerations.
"""

from shared.utils import recommendation_id


def test_returns_16_char_hex_digest():
    out = recommendation_id({'type': 'gap', 'title': 'X'})
    assert len(out) == 16
    int(out, 16)  # raises if not hex


def test_same_inputs_yield_same_id():
    rec_a = {'type': 'gap', 'title': 'Pitch outdoor publishers'}
    rec_b = {'type': 'gap', 'title': 'Pitch outdoor publishers'}
    assert recommendation_id(rec_a) == recommendation_id(rec_b)


def test_different_titles_yield_different_ids():
    a = {'type': 'gap', 'title': 'A'}
    b = {'type': 'gap', 'title': 'B'}
    assert recommendation_id(a) != recommendation_id(b)


def test_different_types_yield_different_ids():
    a = {'type': 'gap', 'title': 'X'}
    b = {'type': 'visibility', 'title': 'X'}
    assert recommendation_id(a) != recommendation_id(b)


def test_keyword_order_does_not_affect_id():
    a = {'type': 'gap', 'title': 'X', 'keywords': ['shoes', 'boots']}
    b = {'type': 'gap', 'title': 'X', 'keywords': ['boots', 'shoes']}
    assert recommendation_id(a) == recommendation_id(b)


def test_keyword_set_membership_does_change_id():
    a = {'type': 'gap', 'title': 'X', 'keywords': ['shoes']}
    b = {'type': 'gap', 'title': 'X', 'keywords': ['shoes', 'boots']}
    assert recommendation_id(a) != recommendation_id(b)


def test_description_changes_do_not_affect_id():
    a = {'type': 'gap', 'title': 'X', 'description': 'one'}
    b = {'type': 'gap', 'title': 'X', 'description': 'two'}
    assert recommendation_id(a) == recommendation_id(b)


def test_action_changes_do_not_affect_id():
    a = {'type': 'gap', 'title': 'X', 'action': 'one'}
    b = {'type': 'gap', 'title': 'X', 'action': 'two'}
    assert recommendation_id(a) == recommendation_id(b)


def test_same_id_when_type_and_title_differ_only_by_case():
    a = {'type': 'GAP', 'title': 'Pitch X'}
    b = {'type': 'gap', 'title': 'pitch x'}
    assert recommendation_id(a) == recommendation_id(b)


def test_a_provider_gap_keeps_the_id_it_had_before_display_names():
    # Statuses saved before 2.54.0 hashed "Not Appearing on Gemini" (the engine id title-cased).
    before = {'type': 'provider_gap', 'title': 'Not Appearing on Gemini', 'keywords': ['kw-a', 'kw-b', 'kw-c']}
    now = {
        'type': 'provider_gap', 'provider': 'gemini', 'title': 'Not Appearing on Google Gemini',
        'keywords': ['kw-a', 'kw-b', 'kw-c'],
    }
    assert recommendation_id(now) == recommendation_id(before) == 'bf52210486b4acf3'


def test_a_provider_gap_id_ignores_the_display_title():
    a = {'type': 'provider_gap', 'provider': 'google_ai_overview', 'title': 'Not Appearing on Google AI Overviews'}
    b = {'type': 'provider_gap', 'provider': 'google_ai_overview', 'title': 'Not Appearing on Google_Ai_Overview'}
    assert recommendation_id(a) == recommendation_id(b)
