"""
Unit tests for shared.auth — the authorization tier (AUDIT-2026-08-19 §0).

Every test here defends a fail-closed property. Before this module existed any
authenticated caller could `PUT /api/users/<self>` with `{"groups":["Admin"]}`,
so the invariant under test is not "the happy path works" but "each of the many
ways the group claim can be missing, malformed, or lookalike denies access".

The `event` shapes exercised below are the real ones: an API Gateway REST proxy
event with a Cognito authorizer, a direct `lambda:InvokeFunction` payload with
no `requestContext` at all, and the two wire encodings of `cognito:groups`.
"""

from __future__ import annotations

import importlib
import json
import os
import string
import sys
from typing import Any

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

# The shared package __init__ re-exports api_response as a function, which
# can shadow the submodule. Point sys.path at lambda/ (so `import shared.auth`
# resolves to the in-repo module) and import directly.
_REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
_LAMBDA_DIR = os.path.join(_REPO, 'lambda')
if _LAMBDA_DIR not in sys.path:
    sys.path.insert(0, _LAMBDA_DIR)

auth = importlib.import_module('shared.auth')

ADMIN_GROUP = auth.ADMIN_GROUP
GROUPS_CLAIM = auth.GROUPS_CLAIM
get_caller_claims = auth.get_caller_claims
get_caller_groups = auth.get_caller_groups
get_caller_identity = auth.get_caller_identity
is_self_reference = auth.is_self_reference
require_group = auth.require_group


# ---------------------------------------------------------------------------
# Event builders. `authenticated_event` mirrors what API Gateway's Cognito
# authorizer actually delivers; `unauthenticated_event` mirrors a direct
# Lambda invoke, which is the shape that must never be mistaken for a
# privileged caller.
# ---------------------------------------------------------------------------

def authenticated_event(
    groups: Any = ADMIN_GROUP,
    username: str = 'admin@example.com',
    method: str = 'PUT',
    path: str = '/api/users/admin@example.com',
    extra_claims: dict[str, Any] | None = None,
    include_groups_claim: bool = True,
) -> dict[str, Any]:
    """Build an API Gateway REST event carrying Cognito authorizer claims."""
    claims: dict[str, Any] = {
        'sub': '11111111-2222-3333-4444-555555555555',
        'cognito:username': username,
        'email': username,
    }
    if include_groups_claim:
        claims[GROUPS_CLAIM] = groups
    if extra_claims is not None:
        claims.update(extra_claims)

    return {
        'httpMethod': method,
        'path': path,
        'headers': {'origin': 'http://localhost:3000'},
        'requestContext': {'authorizer': {'claims': claims}},
    }


def unauthenticated_event(method: str = 'PUT') -> dict[str, Any]:
    """Build the shape a direct lambda:InvokeFunction produces — no requestContext."""
    return {'httpMethod': method, 'path': '/api/users', 'headers': {}}


def parse_response(result: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    """Extract status code and parsed body from a Lambda response."""
    body = result.get('body')
    parsed = json.loads(body) if isinstance(body, str) and body else {}
    return result.get('statusCode', 200), parsed


def allow_all(event: dict[str, Any], context: Any, **kwargs) -> dict[str, Any]:
    """Stand-in for a real handler; echoes what it received."""
    return {'statusCode': 200, 'body': json.dumps({'reached': True, 'kwargs': sorted(kwargs)})}


class TestGetCallerGroups:
    """
    Parsing the `cognito:groups` claim.

    API Gateway flattens the JWT's string array, so the claim arrives as text
    rather than a list. Every unparseable shape must yield an empty set, since
    an empty set is what makes `require_group` deny.
    """

    def test_returns_every_group_from_a_comma_separated_claim(self) -> None:
        event = authenticated_event(groups='Admin,Users')

        assert get_caller_groups(event) == frozenset({'Admin', 'Users'})

    def test_returns_every_group_from_a_bracketed_space_separated_claim(self) -> None:
        """API Gateway emits `[Admin Users]` for some payload shapes."""
        event = authenticated_event(groups='[Admin Users]')

        assert get_caller_groups(event) == frozenset({'Admin', 'Users'})

    def test_returns_every_group_when_claim_is_a_genuine_list(self) -> None:
        event = authenticated_event(groups=['Admin', 'Users'])

        assert get_caller_groups(event) == frozenset({'Admin', 'Users'})

    def test_strips_surrounding_whitespace_from_each_group_name(self) -> None:
        event = authenticated_event(groups='Admin , Users')

        assert get_caller_groups(event) == frozenset({'Admin', 'Users'})

    def test_ignores_non_string_members_of_a_list_claim(self) -> None:
        event = authenticated_event(groups=['Admin', None, 42, {'nested': 'dict'}])

        assert get_caller_groups(event) == frozenset({'Admin'})

    def test_returns_empty_set_when_claim_is_an_empty_string(self) -> None:
        event = authenticated_event(groups='')

        assert get_caller_groups(event) == frozenset()

    def test_returns_empty_set_when_claim_is_whitespace_only(self) -> None:
        event = authenticated_event(groups='   ')

        assert get_caller_groups(event) == frozenset()

    def test_returns_empty_set_when_claim_is_an_empty_bracket_pair(self) -> None:
        event = authenticated_event(groups='[]')

        assert get_caller_groups(event) == frozenset()

    def test_returns_empty_set_when_groups_claim_is_absent(self) -> None:
        """A user in no group at all — the common case for an invited user."""
        event = authenticated_event(include_groups_claim=False)

        assert get_caller_groups(event) == frozenset()

    def test_returns_empty_set_when_claim_is_not_a_string_or_sequence(self) -> None:
        event = authenticated_event(groups=42)

        assert get_caller_groups(event) == frozenset()

    def test_returns_empty_set_when_claims_are_absent(self) -> None:
        event = {'httpMethod': 'PUT', 'requestContext': {'authorizer': {}}}

        assert get_caller_groups(event) == frozenset()

    def test_returns_empty_set_when_authorizer_is_absent(self) -> None:
        event = {'httpMethod': 'PUT', 'requestContext': {}}

        assert get_caller_groups(event) == frozenset()

    def test_returns_empty_set_when_request_context_is_absent(self) -> None:
        """
        REGRESSION: the Step Functions role can invoke every CitationAnalysis-*
        function directly, bypassing API Gateway. That event has no
        requestContext, and it must not read as an unrestricted caller.
        """
        assert get_caller_groups(unauthenticated_event()) == frozenset()

    def test_returns_empty_set_when_request_context_is_null(self) -> None:
        """API Gateway sends literal null for absent structures."""
        event = {'httpMethod': 'PUT', 'requestContext': None}

        assert get_caller_groups(event) == frozenset()

    def test_returns_empty_set_when_claims_is_not_a_mapping(self) -> None:
        event = {'requestContext': {'authorizer': {'claims': 'Admin'}}}

        assert get_caller_groups(event) == frozenset()

    def test_returns_empty_set_when_event_is_not_a_dict(self) -> None:
        assert get_caller_groups(None) == frozenset()


class TestGetCallerClaims:
    """Claim extraction, kept separate so failures point at the right layer."""

    def test_returns_the_claims_mapping_when_present(self) -> None:
        event = authenticated_event(username='alice@example.com')

        assert get_caller_claims(event)['cognito:username'] == 'alice@example.com'

    def test_returns_empty_dict_for_a_direct_lambda_invoke(self) -> None:
        assert get_caller_claims(unauthenticated_event()) == {}


class TestRequireGroupAllows:
    """The permitted paths — a gate that denies everyone is not a fix."""

    def test_invokes_the_wrapped_handler_when_caller_is_in_the_required_group(self) -> None:
        gated = require_group(ADMIN_GROUP)(allow_all)

        status, body = parse_response(gated(authenticated_event(), None))

        assert status == 200
        assert body['reached'] is True

    def test_invokes_the_wrapped_handler_when_caller_has_one_of_several_groups(self) -> None:
        gated = require_group('Editors', ADMIN_GROUP)(allow_all)

        status, _ = parse_response(gated(authenticated_event(groups='Users,Admin'), None))

        assert status == 200

    def test_passes_keyword_arguments_through_to_the_wrapped_handler(self) -> None:
        """@paginate and @parse_json_body inject kwargs the gate must not eat."""
        gated = require_group(ADMIN_GROUP)(allow_all)

        _, body = parse_response(gated(authenticated_event(), None, limit=50, offset=0))

        assert body['kwargs'] == ['limit', 'offset']

    def test_passes_positional_arguments_through_to_the_wrapped_handler(self) -> None:
        """manage-query-prompts passes prompt_id positionally after context."""
        def handler_with_positional(event, context, prompt_id, **kwargs) -> dict[str, Any]:
            return {'statusCode': 200, 'body': json.dumps({'prompt_id': prompt_id})}

        gated = require_group(ADMIN_GROUP)(handler_with_positional)

        _, body = parse_response(gated(authenticated_event(), None, 'prompt-42'))

        assert body['prompt_id'] == 'prompt-42'

    def test_preserves_the_wrapped_function_name(self) -> None:
        """@api_handler logs func.__name__, and vulture matches on it."""
        gated = require_group(ADMIN_GROUP)(allow_all)

        assert gated.__name__ == 'allow_all'


class TestRequireGroupDenies:
    """
    The refusals. Each case is a distinct way the claim can fail to establish
    Admin membership, and each must produce a 403 without running the handler.
    """

    def test_returns_403_when_caller_is_in_a_different_group(self) -> None:
        gated = require_group(ADMIN_GROUP)(allow_all)

        status, _ = parse_response(gated(authenticated_event(groups='Users'), None))

        assert status == 403

    def test_does_not_invoke_the_wrapped_handler_when_denied(self) -> None:
        """
        The handler is what calls admin_add_user_to_group / put_secret_value.
        A 403 body with the side effect already applied would be no fix at all.
        """
        calls: list[str] = []

        def recording_handler(event, context, **kwargs) -> dict[str, Any]:
            calls.append('invoked')
            return {'statusCode': 200, 'body': '{}'}

        gated = require_group(ADMIN_GROUP)(recording_handler)
        gated(authenticated_event(groups='Users'), None)

        assert calls == []

    def test_returns_403_when_groups_claim_is_absent(self) -> None:
        gated = require_group(ADMIN_GROUP)(allow_all)

        status, _ = parse_response(gated(authenticated_event(include_groups_claim=False), None))

        assert status == 403

    def test_returns_403_when_groups_claim_is_empty(self) -> None:
        gated = require_group(ADMIN_GROUP)(allow_all)

        status, _ = parse_response(gated(authenticated_event(groups=''), None))

        assert status == 403

    def test_returns_403_for_a_direct_lambda_invoke_with_no_request_context(self) -> None:
        gated = require_group(ADMIN_GROUP)(allow_all)

        status, _ = parse_response(gated(unauthenticated_event(), None))

        assert status == 403

    def test_returns_403_when_group_name_only_contains_the_required_name(self) -> None:
        """
        REGRESSION: substring matching is the bug class in AUDIT §2.15. A group
        called `Admins` or `NotAdmin` must not satisfy `Admin`.
        """
        gated = require_group(ADMIN_GROUP)(allow_all)

        for lookalike in ('Admins', 'NotAdmin', 'Administrators', 'Admin-readonly'):
            status, _ = parse_response(gated(authenticated_event(groups=lookalike), None))

            assert status == 403, f"{lookalike!r} must not satisfy {ADMIN_GROUP!r}"

    def test_returns_403_for_a_case_variant_of_the_required_group(self) -> None:
        """Cognito group names are case-sensitive; so is the check."""
        gated = require_group(ADMIN_GROUP)(allow_all)

        status, _ = parse_response(gated(authenticated_event(groups='admin'), None))

        assert status == 403

    def test_403_body_does_not_disclose_the_required_group_name(self) -> None:
        """
        Enumerating group names is the first step of the escalation path the
        audit describes, so the refusal must not hand them over.
        """
        gated = require_group(ADMIN_GROUP)(allow_all)

        _, body = parse_response(gated(authenticated_event(groups='Users'), None))

        assert ADMIN_GROUP not in json.dumps(body)

    def test_403_carries_cors_headers_so_the_browser_can_read_it(self) -> None:
        """A 403 the browser turns into an opaque CORS error is undebuggable."""
        gated = require_group(ADMIN_GROUP)(allow_all)

        result = gated(authenticated_event(groups='Users'), None)

        assert 'Access-Control-Allow-Origin' in result['headers']

    @settings(max_examples=200, deadline=None)
    @given(
        st.lists(
            st.text(
                alphabet=string.ascii_letters + string.digits + '_-.',
                min_size=1,
                max_size=24,
            ),
            max_size=6,
        )
    )
    def test_denies_every_group_set_that_excludes_the_required_group(
        self, groups: list[str]
    ) -> None:
        """
        Property: membership is exact set intersection. No combination of other
        group names — however similar — grants Admin.
        """
        if ADMIN_GROUP in groups:
            return

        gated = require_group(ADMIN_GROUP)(allow_all)
        status, _ = parse_response(gated(authenticated_event(groups=','.join(groups)), None))

        assert status == 403


class TestRequireGroupMisuse:
    """Guard rails against a gate that silently authorizes everyone."""

    def test_raises_value_error_when_constructed_with_no_groups(self) -> None:
        with pytest.raises(ValueError) as excinfo:
            require_group()

        assert 'at least one group' in str(excinfo.value)


class TestGetCallerIdentity:
    """Resolving who the caller is, for the self-modification guard."""

    def test_returns_the_cognito_username_claim(self) -> None:
        event = authenticated_event(username='alice@example.com')

        assert get_caller_identity(event) == 'alice@example.com'

    def test_falls_back_to_the_email_claim_when_username_is_absent(self) -> None:
        event = authenticated_event()
        del event['requestContext']['authorizer']['claims']['cognito:username']

        assert get_caller_identity(event) == 'admin@example.com'

    def test_returns_none_when_no_identity_claim_is_present(self) -> None:
        event = {'requestContext': {'authorizer': {'claims': {GROUPS_CLAIM: 'Admin'}}}}

        assert get_caller_identity(event) is None


class TestIsSelfReference:
    """
    Detecting self-directed changes. An admin editing their own groups is
    indistinguishable from the escalation attack, and an admin deleting
    themselves can lock the last administrator out irreversibly.
    """

    def test_true_when_target_matches_the_caller_username(self) -> None:
        event = authenticated_event(username='alice@example.com')

        assert is_self_reference(event, 'alice@example.com') is True

    def test_true_when_target_differs_only_by_letter_case(self) -> None:
        """Pool usernames are lowercased emails; callers may not lowercase."""
        event = authenticated_event(username='alice@example.com')

        assert is_self_reference(event, 'Alice@Example.COM') is True

    def test_true_when_target_has_surrounding_whitespace(self) -> None:
        event = authenticated_event(username='alice@example.com')

        assert is_self_reference(event, '  alice@example.com  ') is True

    def test_true_when_target_matches_the_caller_subject_claim(self) -> None:
        event = authenticated_event(username='alice@example.com')
        subject = event['requestContext']['authorizer']['claims']['sub']

        assert is_self_reference(event, subject) is True

    def test_false_when_target_is_a_different_user(self) -> None:
        event = authenticated_event(username='alice@example.com')

        assert is_self_reference(event, 'bob@example.com') is False

    def test_true_when_caller_identity_cannot_be_determined(self) -> None:
        """Fail closed: we cannot prove the request is not self-directed."""
        event = {'requestContext': {'authorizer': {'claims': {GROUPS_CLAIM: 'Admin'}}}}

        assert is_self_reference(event, 'bob@example.com') is True

    def test_true_when_claims_are_absent(self) -> None:
        assert is_self_reference(unauthenticated_event(), 'bob@example.com') is True

    def test_false_when_no_target_is_supplied(self) -> None:
        """No target means no self-reference to guard; the caller 400s instead."""
        event = authenticated_event(username='alice@example.com')

        assert is_self_reference(event, None) is False
