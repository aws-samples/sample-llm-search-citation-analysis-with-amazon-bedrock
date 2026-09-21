"""Shared valid request data for Content Studio brief tests."""

from __future__ import annotations

from shared.content_brief import (
    CREATE_NEW_LANDING_PAGE,
    DEFAULT_PROMPT_TEMPLATES,
    GROUP_BRIEF_TYPE,
)


def _brief_content_defaults() -> dict[str, object]:
    return {
        'content_angle': CREATE_NEW_LANDING_PAGE,
        'landing_url': '',
        'current_copy': '',
        'prompt_template': DEFAULT_PROMPT_TEMPLATES[CREATE_NEW_LANDING_PAGE],
        'output_language': 'English',
    }


def build_group_brief(**overrides: object) -> dict[str, object]:
    """Return the legacy group-plus-selected-keywords request shape."""
    brief: dict[str, object] = {
        **_brief_content_defaults(),
        'id': 'brief-1',
        'type': GROUP_BRIEF_TYPE,
        'group_id': 'group-1',
        'group_name': 'Client supplied group',
        'keyword': 'client supplied group',
        'keyword_ids': ['keyword-1'],
        'keywords': ['client supplied keyword'],
    }
    brief.update(overrides)
    return brief


def build_scoped_content_brief(**overrides: object) -> dict[str, object]:
    """Return a current group-scope request with stale display fields."""
    brief: dict[str, object] = {
        **_brief_content_defaults(),
        'id': 'brief-1',
        'type': GROUP_BRIEF_TYPE,
        'scope': {'mode': 'groups', 'group_ids': ['group-1']},
        'group_name': 'Client supplied group',
        'keyword': 'client supplied scope',
        'keyword_ids': ['stale-keyword-id'],
        'keywords': ['client supplied keyword'],
    }
    brief.update(overrides)
    return brief


def build_batch_request(**overrides: object) -> dict[str, object]:
    """Return a two-keyword background-generation batch request."""
    request: dict[str, object] = {
        'batch_id': 'batch-1',
        'scope': {
            'mode': 'keywords',
            'keyword_ids': ['keyword-1', 'keyword-2'],
        },
        'brief': build_batch_brief(),
    }
    request.update(overrides)
    return request


def content_brief_template_item(**overrides: object) -> dict[str, object]:
    """Return one saved Content Studio template row."""
    item: dict[str, object] = {
        'id': 'template-1',
        'name': 'Saved landing page',
        'description': 'Saved description',
        'content_angle': CREATE_NEW_LANDING_PAGE,
        'prompt_template': DEFAULT_PROMPT_TEMPLATES[CREATE_NEW_LANDING_PAGE],
        'builtin': False,
        'created_by': 'writer@example.com',
        'created_at': '2026-09-20T10:00:00Z',
        'updated_at': '2026-09-20T10:00:00Z',
    }
    item.update(overrides)
    return item


def active_keyword(
    keyword_id: str,
    keyword: str,
    *,
    group_ids: set[str] | None = None,
) -> dict[str, object]:
    """Return one active authoritative keyword row."""
    item: dict[str, object] = {
        'id': keyword_id,
        'keyword': keyword,
        'status': 'active',
    }
    if group_ids is not None:
        item['group_ids'] = group_ids
    return item



def build_keyword_scoped_content_brief(
    keyword_ids: list[str] | None = None,
    **overrides: object,
) -> dict[str, object]:
    """Return a current selected-keyword request."""
    return build_scoped_content_brief(
        scope={
            'mode': 'keywords',
            'keyword_ids': keyword_ids or ['keyword-1'],
        },
        **overrides,
    )


def cross_group_keyword_rows() -> list[dict[str, object]]:
    """Return two selected keywords that deliberately share no group."""
    return [
        active_keyword('keyword-1', 'Alpha', group_ids={'group-1'}),
        active_keyword('keyword-2', 'Beta', group_ids={'group-2'}),
    ]


def mixed_group_keyword_rows() -> list[dict[str, object]]:
    """Return two members of group one plus one unrelated keyword."""
    return [
        active_keyword('keyword-2', 'Beta', group_ids={'group-1'}),
        active_keyword('keyword-1', 'Alpha', group_ids={'group-1'}),
        active_keyword('keyword-3', 'Other', group_ids={'group-2'}),
    ]



def cross_group_scope_case() -> tuple[dict[str, object], list[dict[str, object]]]:
    """Return a two-keyword request and authoritative rows from different groups."""
    return (
        build_keyword_scoped_content_brief(['keyword-1', 'keyword-2']),
        cross_group_keyword_rows(),
    )



def build_batch_brief(**overrides: object) -> dict[str, object]:
    """Return a valid nested batch brief with optional field changes."""
    brief = _brief_content_defaults()
    brief.update(overrides)
    return brief
