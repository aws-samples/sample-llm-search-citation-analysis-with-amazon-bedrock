"""Shared valid request data for Content Studio group brief tests."""

from __future__ import annotations

from shared.content_brief import (
    CREATE_NEW_LANDING_PAGE,
    DEFAULT_PROMPT_TEMPLATES,
    GROUP_BRIEF_TYPE,
)


def build_group_brief(**overrides: object) -> dict[str, object]:
    """Return a complete create-new brief with stale client display text."""
    brief: dict[str, object] = {
        'id': 'brief-1',
        'type': GROUP_BRIEF_TYPE,
        'group_id': 'group-1',
        'group_name': 'Client supplied group',
        'keyword': 'client supplied group',
        'keyword_ids': ['keyword-1'],
        'keywords': ['client supplied keyword'],
        'content_angle': CREATE_NEW_LANDING_PAGE,
        'landing_url': '',
        'current_copy': '',
        'prompt_template': DEFAULT_PROMPT_TEMPLATES[CREATE_NEW_LANDING_PAGE],
        'output_language': 'English',
    }
    brief.update(overrides)
    return brief
