"""
The route size-policy registry (``test-fixtures/route-size-policies.json``).

A Lambda proxy response is capped at 6 MiB, and a route whose answer grows
with customer data crosses it silently: the customer sees a bare 502. Every
route therefore declares how its response is bounded, and every route whose
answer grows with data (``paginated``, ``top_n``, ``summary``) names a volume
test that feeds it a large, realistic data set and checks the response size.

``lib/response-size.spec.ts`` checks the registry against the API Gateway
routes of the synthesized stack; this module checks it against the router
route maps and checks that each named volume test exists.
"""

from __future__ import annotations

import ast
import json
from pathlib import Path
from typing import Any

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[2]
_API_DIR = Path(__file__).resolve().parent
_REGISTRY = _REPO_ROOT / 'test-fixtures' / 'route-size-policies.json'

# Routers dispatching through a ROUTE_MAP literal (keyword-mgmt routes in code;
# its routes are checked against API Gateway by lib/response-size.spec.ts).
ROUTERS = ('citations-content', 'config-mgmt', 'execution-mgmt', 'stats-insights')
POLICIES = {'paginated', 'top_n', 'summary', 'single_item', 'bounded'}
# Policies whose answers grow with customer data, so a volume test must prove the bound.
GROWING_POLICIES = {'paginated', 'top_n', 'summary'}
METHODS = {'GET', 'POST', 'PUT', 'PATCH', 'DELETE'}


def _registry() -> list[dict[str, Any]]:
    return json.loads(_REGISTRY.read_text(encoding='utf-8'))['routes']


def _route_map(router: str) -> dict[str, str]:
    """The ``ROUTE_MAP`` literal of a router file, read without importing it."""
    tree = ast.parse((_API_DIR / f'{router}.py').read_text(encoding='utf-8'))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'ROUTE_MAP' for target in node.targets):
            return ast.literal_eval(node.value)
    raise AssertionError(f'{router}.py has no ROUTE_MAP literal')


def _covers(prefix: str, route: str) -> bool:
    """Whether a route-map prefix dispatches ``route`` (exact or ``prefix/...``, as ``shared.router``).

    A ``{param}`` segment on either side matches any segment, so the route
    map's ``/api/providers/bedrock`` is served by ``/api/providers/{id}``.
    """
    prefix_parts, route_parts = prefix.split('/'), route.split('/')
    if len(prefix_parts) > len(route_parts):
        return False
    return all(
        left == right or left.startswith('{') or right.startswith('{')
        for left, right in zip(prefix_parts, route_parts, strict=False)
    )


def _test_exists(reference: str) -> bool:
    """Whether ``path::[Class::]test_name`` names a test function in that file (and class)."""
    path, *names = reference.split('::')
    source = _REPO_ROOT / path
    if not source.is_file() or not names:
        return False
    tree = ast.parse(source.read_text(encoding='utf-8'))
    scope: list[ast.stmt] = tree.body
    for class_name in names[:-1]:
        found = next((node for node in scope if isinstance(node, ast.ClassDef) and node.name == class_name), None)
        if found is None:
            return False
        scope = found.body
    return any(isinstance(node, ast.FunctionDef) and node.name == names[-1] for node in scope)


REGISTRY = _registry()


@pytest.mark.parametrize('router', ROUTERS)
def test_every_route_map_prefix_has_a_declared_size_policy(router: str) -> None:
    declared = [entry['route'] for entry in REGISTRY]

    undeclared = [prefix for prefix in _route_map(router) if not any(_covers(prefix, route) for route in declared)]

    assert undeclared == []


@pytest.mark.parametrize('entry', REGISTRY, ids=[entry['route'] for entry in REGISTRY])
def test_declares_a_known_policy_and_http_methods(entry: dict[str, Any]) -> None:
    assert (entry['policy'] in POLICIES, set(entry['methods']) <= METHODS, bool(entry['bound'].strip())) == (True, True, True)


_GROWING = [entry for entry in REGISTRY if entry['policy'] in GROWING_POLICIES]


@pytest.mark.parametrize('entry', _GROWING, ids=[entry['route'] for entry in _GROWING])
def test_routes_whose_answer_grows_with_data_name_a_volume_test(entry: dict[str, Any]) -> None:
    assert entry['volume_test'], f"{entry['route']} is {entry['policy']} but names no volume test"


_WITH_TESTS = [entry for entry in REGISTRY if entry['volume_test']]


@pytest.mark.parametrize('entry', _WITH_TESTS, ids=[entry['route'] for entry in _WITH_TESTS])
def test_named_volume_test_exists(entry: dict[str, Any]) -> None:
    assert _test_exists(entry['volume_test']), f"{entry['volume_test']} does not exist"


def test_covers_matches_path_parameters_and_sub_paths() -> None:
    assert (
        _covers('/api/recommendations/{id}/status', '/api/recommendations/r-1/status'),
        _covers('/api/providers/bedrock', '/api/providers/{id}/models'),
        _covers('/api/raw-responses', '/api/raw-responses/file'),
        _covers('/api/stats', '/api/statsx'),
        _covers('/api/reports/insights', '/api/reports'),
    ) == (True, True, True, False, False)
