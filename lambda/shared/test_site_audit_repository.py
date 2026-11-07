"""DynamoDB layout of site audits (``shared.site_audit_repository``)."""

from __future__ import annotations

import time
from unittest.mock import MagicMock

from shared.audit_issues import Issue
from shared.audit_urls import url_hash
from shared.site_audit_repository import AuditStore, FrontierEntry, decode_token, encode_token
from testing.dynamodb_stubs import conditional_check_failure

AUDIT = 'a' * 32


def store_with(table: MagicMock | None = None, existing: list[dict] | None = None) -> tuple[AuditStore, MagicMock]:
    table = table or MagicMock()
    table.name = 'test-seo-audits'
    table.update_item.return_value = {'Attributes': {'seq': 3}}
    resource = MagicMock()
    resource.batch_get_item.return_value = {'Responses': {'test-seo-audits': existing or []}}
    return AuditStore(table, resource), table


def written_items(table: MagicMock) -> list[dict]:
    """Items put through the table's batch writer, in order."""
    put_calls = table.batch_writer.return_value.__enter__.return_value.put_item.call_args_list
    return [call.kwargs['Item'] for call in put_calls]


def test_a_new_audit_is_listed_newest_first_through_gsi1():
    store, table = store_with()
    store.create_audit({'audit_id': AUDIT, 'started_at': '2026-10-02T08:00:00Z'})
    item = table.put_item.call_args.kwargs['Item']

    assert (item['pk'], item['sk'], item['gsi1pk'], item['gsi1sk']) == (
        f'AUDIT#{AUDIT}', 'META', 'AUDITS', f'2026-10-02T08:00:00Z#{AUDIT}',
    )


def test_every_item_expires_after_ninety_days():
    store, table = store_with()
    store.create_audit({'audit_id': AUDIT, 'started_at': 'x'})
    item = table.put_item.call_args.kwargs['Item']

    assert 89 * 86_400 < item['ttl'] - time.time() <= 90 * 86_400


def test_pending_links_sort_before_sitemap_urls():
    store, table = store_with()
    store.add_frontier(AUDIT, [FrontierEntry('https://www.example.com/s', None, 'sitemap', True),
                               FrontierEntry('https://www.example.com/l', 1, 'link', False)], limit=10)

    assert sorted(item['gsi1sk'][0] for item in written_items(table)) == ['0', '1']


def test_frontier_skips_urls_already_known():
    known = {'pk': f'AUDIT#{AUDIT}#URL', 'sk': url_hash('https://www.example.com/a'), 'url': 'https://www.example.com/a',
             'source': 'link', 'state': 'crawled', 'in_sitemap': True}
    store, _table = store_with(existing=[known])

    assert store.add_frontier(AUDIT, [FrontierEntry('https://www.example.com/a', 1, 'link', False)], limit=10) == 0


def test_frontier_add_respects_the_limit():
    store, _table = store_with()
    entries = [FrontierEntry(f'https://www.example.com/{index}', 1, 'link', False) for index in range(5)]

    assert store.add_frontier(AUDIT, entries, limit=2) == 2


def test_claim_returns_the_chunks_leased_urls_first_when_retried():
    store, table = store_with()
    leased = {'url': 'https://www.example.com/a', 'depth': 1, 'source': 'link', 'in_sitemap': False}
    table.query.return_value = {'Items': [leased]}

    assert [entry.url for entry in store.claim(AUDIT, 2, 10)] == ['https://www.example.com/a']


def test_claim_skips_a_url_another_step_leased_first():
    store, table = store_with()
    pending = [{'pk': 'p', 'sk': '1', 'url': 'https://www.example.com/a', 'source': 'link'},
               {'pk': 'p', 'sk': '2', 'url': 'https://www.example.com/b', 'source': 'link'}]
    table.query.side_effect = [{'Items': []}, {'Items': pending}]
    table.update_item.side_effect = [conditional_check_failure(), {}]

    assert [entry.url for entry in store.claim(AUDIT, 0, 10)] == ['https://www.example.com/b']


def test_update_audit_reports_false_when_the_status_condition_fails():
    store, table = store_with()
    table.update_item.side_effect = conditional_check_failure()

    assert store.update_audit(AUDIT, {'status': 'running'}, only_if_status=('queued',)) is False


def test_issues_are_keyed_by_type_and_deterministic_id():
    store, table = store_with()
    store.put_issues(AUDIT, [Issue('missing-title', 'https://www.example.com/')])
    item = written_items(table)[0]

    assert (item['pk'], item['sk'].split('#')[0], item['severity'], item['group']) == (
        f'AUDIT#{AUDIT}#ISSUE', 'missing-title', 'critical', 'content',
    )


def test_paging_token_round_trips_for_its_partition():
    key = {'pk': f'AUDIT#{AUDIT}#PAGE', 'sk': 'abc'}

    assert decode_token(encode_token(key), f'AUDIT#{AUDIT}#PAGE') == key


def test_paging_token_for_another_partition_is_ignored():
    token = encode_token({'pk': 'AUDIT#other#PAGE', 'sk': 'abc'})

    assert decode_token(token, f'AUDIT#{AUDIT}#PAGE') is None


def test_garbled_paging_token_is_ignored():
    assert decode_token('%%%not-base64', f'AUDIT#{AUDIT}#PAGE') is None
