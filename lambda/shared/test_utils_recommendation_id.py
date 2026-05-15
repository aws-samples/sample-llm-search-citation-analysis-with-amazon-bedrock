"""
Tests for shared.utils.recommendation_id — the deterministic hash used
to track recommendation status across list-regenerations.
"""

import importlib
import os
import sys

# Mount shared layer / fall back to lambda/ source tree.
_REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
_LAYER_PY = os.path.join(_REPO, 'lambda', 'layer', 'python')
_LAMBDA_DIR = os.path.join(_REPO, 'lambda')
if os.path.isdir(_LAYER_PY) and _LAYER_PY not in sys.path:
    sys.path.insert(0, _LAYER_PY)
elif _LAMBDA_DIR not in sys.path:
    sys.path.insert(0, _LAMBDA_DIR)

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


def test_case_insensitive_on_type_and_title():
    a = {'type': 'GAP', 'title': 'Pitch X'}
    b = {'type': 'gap', 'title': 'pitch x'}
    assert recommendation_id(a) == recommendation_id(b)
