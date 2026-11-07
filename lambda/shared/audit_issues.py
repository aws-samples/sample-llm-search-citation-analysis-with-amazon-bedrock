"""
One finding of a site audit (``Issue``) and the merged registry of every issue type (``ISSUE_TYPES``).

An issue names its type, the page it was found on (the start URL for site-level findings) and small JSON
details. Its id is deterministic (a hash of audit, type, page and ``dedupe_key``), so a retried step writes
the same items again instead of duplicating them; ``dedupe_key`` tells apart several issues of one type on one
page (one broken link per target).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any

from shared.audit_geo_registry import GEO_ISSUE_TYPES
from shared.audit_issue_registry import GROUPS, SEO_ISSUE_TYPES, SEVERITY_ORDER, IssueType

ISSUE_TYPES: dict[str, IssueType] = {**SEO_ISSUE_TYPES, **GEO_ISSUE_TYPES}
MAX_FLAGGED_TEXT_CHARS = 100


@dataclass(frozen=True)
class Issue:
    issue_type: str
    page_url: str
    details: dict[str, Any] = field(default_factory=dict)
    dedupe_key: str = ''

    @property
    def descriptor(self) -> IssueType:
        return ISSUE_TYPES[self.issue_type]

    def issue_id(self, audit_id: str) -> str:
        parts = f'{audit_id}|{self.issue_type}|{self.page_url}|{self.dedupe_key}'
        return hashlib.sha256(parts.encode('utf-8')).hexdigest()[:36]


def flagged(text: str) -> str:
    """Page text quoted in an issue's details, cut to 100 characters."""
    return text[:MAX_FLAGGED_TEXT_CHARS]


def descriptor_json(issue_type: str) -> dict[str, str]:
    """The registry entry of ``issue_type`` as the API returns it."""
    entry = ISSUE_TYPES[issue_type]
    return {
        'issue_type': issue_type,
        'severity': entry.severity,
        'group': entry.group,
        'title': entry.title,
        'explanation': entry.explanation,
        'how_to_fix': entry.how_to_fix,
    }


def type_order(issue_type: str) -> tuple[int, int, str]:
    """Sort key: severity (critical first), then group, then id."""
    entry = ISSUE_TYPES[issue_type]
    return SEVERITY_ORDER[entry.severity], GROUPS.index(entry.group), issue_type
