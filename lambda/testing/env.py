"""Environment plumbing for tests of handlers that read configuration at import.

Handlers resolve their table names and ARNs at module level, so a test has to
have the variables in place *before* ``load_handler_module`` executes the file.
"""

from __future__ import annotations

import os
from collections.abc import Generator, Mapping
from contextlib import contextmanager
from unittest.mock import patch

# The name the Keywords-table handlers resolve their table from
# (``resolve_table_env('DYNAMODB_TABLE_KEYWORDS')``).
KEYWORDS_TABLE_ENV: Mapping[str, str] = {
    'DYNAMODB_TABLE_KEYWORDS': 'test-keywords-table',
}

# What the keyword-research handler resolves at import: its job table, the
# state machine it starts, and the templates / groups tables it reads.
KEYWORD_RESEARCH_ENV: Mapping[str, str] = {
    'DYNAMODB_TABLE_KEYWORD_RESEARCH': 'test-keyword-research',
    'RESEARCH_STATE_MACHINE_ARN': 'arn:aws:states:us-west-2:123456789012:stateMachine:research',
    'DYNAMODB_TABLE_RESEARCH_TEMPLATES': 'test-research-templates',
    'DYNAMODB_TABLE_KEYWORD_GROUPS': 'test-keyword-groups',
}

# The four tables get-stats.py counts (and CORS without an origin parameter).
STATS_ENV: Mapping[str, str] = {
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-search-results',
    'DYNAMODB_TABLE_CITATIONS': 'test-citations',
    'DYNAMODB_TABLE_CRAWLED_CONTENT': 'test-crawled',
    'DYNAMODB_TABLE_KEYWORDS': 'test-keywords',
    'CORS_ORIGIN_PARAM': '',
}

# What self-reflection.py resolves at import: the reflections it stores and the tables it reads.
SELF_REFLECTION_ENV: Mapping[str, str] = {
    'DYNAMODB_TABLE_SELF_REFLECTION': 'test-self-reflection',
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-search-results',
    'DYNAMODB_TABLE_QUERY_PROMPTS': 'test-query-prompts',
    'DYNAMODB_TABLE_BRAND_CONFIG': 'test-brand-config',
    'CORS_ORIGIN_PARAM': '',
}

# What manage-schedule.py resolves at import: the workflow it schedules, the role Scheduler assumes, the groups table.
SCHEDULE_ENV: Mapping[str, str] = {
    'STATE_MACHINE_ARN': 'arn:aws:states:us-east-1:123456789012:stateMachine:test',
    'SCHEDULE_ROLE_ARN': 'arn:aws:iam::123456789012:role/test-scheduler-role',
    'DYNAMODB_TABLE_KEYWORD_GROUPS': 'test-keyword-groups',
    'CORS_ORIGIN_PARAM': '',
}


def setdefault_env(defaults: Mapping[str, str]) -> None:
    """``os.environ.setdefault`` for every pair, for modules loaded at collection time.

    Values already present win, so a developer shell pointing at real tables is
    left alone; the defaults only fill the gaps the handler needs to import.
    """
    for name, value in defaults.items():
        os.environ.setdefault(name, value)


@contextmanager
def cleared_env(*names: str) -> Generator[None, None, None]:
    """Unset ``names`` for the block and restore the previous values afterwards."""
    with patch.dict(os.environ):
        for name in names:
            os.environ.pop(name, None)
        yield
