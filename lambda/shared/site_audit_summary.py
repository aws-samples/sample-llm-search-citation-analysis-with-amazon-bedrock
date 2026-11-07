"""
The summary of a finished audit: issue counts by severity, group and type, and a 0-100 health score.

**Score**: ``100 - sum(penalty of each issue type found)``, never below 0. A type's penalty is its severity
weight (critical 15, warning 5, info 1) times ``0.5 + 0.5 x share``, where ``share`` is the fraction of crawled
pages it affects (capped at 1): finding a type at all costs half its weight, finding it everywhere the whole.
A clean crawl scores 100; the score compares audits of one site over time, not sites with each other.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping
from typing import Any

from shared.audit_issue_registry import GROUPS, SEVERITY_ORDER
from shared.audit_issues import ISSUE_TYPES, type_order

SEVERITY_WEIGHTS: dict[str, int] = {'critical': 15, 'warning': 5, 'info': 1}


def health_score(pages_by_type: Mapping[str, int], pages_crawled: int) -> int:
    """The 0-100 score of the issue types found, given how many pages each affects."""
    total = max(pages_crawled, 1)
    penalty = sum(
        SEVERITY_WEIGHTS[ISSUE_TYPES[issue_type].severity] * (0.5 + 0.5 * min(1.0, pages / total))
        for issue_type, pages in pages_by_type.items()
        if issue_type in ISSUE_TYPES
    )
    return max(0, round(100 - penalty))


def summarize(issue_items: Iterable[Mapping[str, Any]], pages_crawled: int) -> dict[str, Any]:
    """Counts and score of an audit's stored issues."""
    issues_by_type: Counter[str] = Counter()
    pages_by_type: dict[str, set[str]] = defaultdict(set)
    for item in issue_items:
        issue_type = str(item.get('issue_type', ''))
        if issue_type not in ISSUE_TYPES:
            continue
        issues_by_type[issue_type] += 1
        pages_by_type[issue_type].add(str(item.get('page_url', '')))
    by_severity = dict.fromkeys(SEVERITY_ORDER, 0)
    by_group = dict.fromkeys(GROUPS, 0)
    for issue_type, count in issues_by_type.items():
        by_severity[ISSUE_TYPES[issue_type].severity] += count
        by_group[ISSUE_TYPES[issue_type].group] += count
    page_counts = {issue_type: len(urls) for issue_type, urls in pages_by_type.items()}
    return {
        'score': health_score(page_counts, pages_crawled),
        'issues_total': sum(issues_by_type.values()),
        'counts_by_severity': by_severity,
        'counts_by_group': by_group,
        'issue_types': [
            {'issue_type': issue_type, 'issues': issues_by_type[issue_type], 'pages': page_counts[issue_type]}
            for issue_type in sorted(issues_by_type, key=type_order)
        ],
    }
