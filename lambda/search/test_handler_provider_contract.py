"""The search handler treats every provider through its definition and runner, never by its name (tenet 5)."""

from __future__ import annotations

import ast
from pathlib import Path

from shared.config import PROVIDERS

_HANDLER = Path(__file__).with_name('handler.py')


def _names_a_provider(node: ast.expr) -> bool:
    """``'google_ai_overview'``-style literals and ``Provider.X`` attributes."""
    if isinstance(node, ast.Constant):
        return node.value in PROVIDERS
    return isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == 'Provider'


def test_handler_compares_nothing_with_a_provider_name() -> None:
    tree = ast.parse(_HANDLER.read_text(encoding='utf-8'))

    checks = [
        ast.unparse(node) for node in ast.walk(tree)
        if isinstance(node, ast.Compare) and any(map(_names_a_provider, [node.left, *node.comparators]))
    ]

    assert checks == []


def test_handler_reads_no_list_of_plain_keyword_providers() -> None:
    assert 'PLAIN_KEYWORD' not in _HANDLER.read_text(encoding='utf-8')
