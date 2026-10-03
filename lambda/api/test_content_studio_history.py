"""Indexed history and batch-status tests for Content Studio."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from testing.content_studio_fixtures import (
    CONTENT_STUDIO_TABLE_NAME,
    batch_manifest_item,
    batch_status_resource,
    call_batch_status,
    call_content_status,
    content_studio_resource,
    load_content_studio_module,
    status_query_pages,
)
from testing.dynamodb_stubs import fake_table
from testing.events import api_gateway_event, parse_response

_mod = load_content_studio_module("content_studio_history_under_test")


def history_row(
    row_id: str,
    status: str,
    created_at: str,
    **overrides: object,
) -> dict[str, object]:
    row: dict[str, object] = {
        "id": row_id,
        "idea_id": f"idea-{row_id}",
        "keyword": f"Keyword {row_id}",
        "status": status,
        "created_at": created_at,
        "updated_at": created_at,
        "generated_content": {},
    }
    row.update(overrides)
    return row


def history_for(limit: int, **pages: list[dict[str, object]]) -> tuple[list[dict[str, object]], MagicMock]:
    """Read `limit` history rows from per-status query pages; return them and the table spy."""
    table = fake_table()
    table.query.side_effect = status_query_pages(**pages)

    with patch.object(_mod, "dynamodb", content_studio_resource(content_table=table)):
        history = _mod.get_content_history(limit)
    return history, table


def call_api(event: dict[str, object], resource: MagicMock) -> tuple[int, Any]:
    """Route one API event through the handler against `resource`."""
    with patch.object(_mod, "dynamodb", resource):
        return parse_response(_mod._api_handler(event, None))


def batch_child_status(position: int, status: str, **fields: object) -> dict[str, object]:
    """One batch-status child for manifest position `position`, before any stored row is observed."""
    child_id = f"child-{position}"
    child: dict[str, object] = {
        "id": child_id,
        "idea_id": f"idea-{child_id}",
        "keyword_id": f"keyword-{position}",
        "keyword": f"Keyword {child_id}",
        "status": status,
        "batch_position": position,
        "created_at": None,
        "updated_at": None,
        "has_content": False,
        "error_message": None,
        "generation_attempts": 0,
        "generation_terminal_reason": None,
    }
    child.update(fields)
    return child


def missing_batch_child(position: int) -> dict[str, object]:
    """The tombstone reported for a manifest child whose row is absent."""
    return batch_child_status(position, "missing", error_message="Content record is unavailable.")


def batch_counts(total: int, **observed: int) -> dict[str, int]:
    """Batch-status counts with every unlisted status at zero."""
    counts: dict[str, int] = dict.fromkeys(("pending", "generating", "generated", "failed", "missing"), 0)
    counts.update(observed)
    return {**counts, "total": total}


def batch_status_body(children: list[dict[str, object]], counts: dict[str, int]) -> dict[str, object]:
    """The full batch-status response for batch-1."""
    return {"batch_id": "batch-1", "batch_size": len(children), "children": children, "counts": counts}


class TestIndexedHistory:
    def test_merges_status_queries_into_newest_global_order(self) -> None:
        history, table = history_for(
            3,
            pending=[history_row("pending", "pending", "2026-09-20T10:04:00Z")],
            generating=[history_row("generating", "generating", "2026-09-20T10:02:00Z")],
            generated=[history_row("generated", "generated", "2026-09-20T10:05:00Z")],
            failed=[history_row("failed", "failed", "2026-09-20T10:03:00Z")],
        )

        assert [item["id"] for item in history] == ["generated", "pending", "failed"]
        assert table.query.call_count == 4
        table.scan.assert_not_called()

    def test_keeps_newest_status_image_when_same_row_appears_in_two_partitions(self) -> None:
        stale = history_row(
            "shared",
            "pending",
            "2026-09-20T10:00:00Z",
            updated_at="2026-09-20T10:01:00Z",
        )
        current = history_row(
            "shared",
            "generated",
            "2026-09-20T10:00:00Z",
            updated_at="2026-09-20T10:05:00Z",
            generated_content={"title": "Ready"},
        )

        history, _ = history_for(20, pending=[stale], generated=[current])

        assert len(history) == 1
        assert history[0]["status"] == "generated"
        assert history[0]["updated_at"] == "2026-09-20T10:05:00Z"

    def test_queries_each_status_newest_first_with_requested_limit(self) -> None:
        _, table = history_for(7)

        assert [current.kwargs["IndexName"] for current in table.query.call_args_list] == [
            "StatusCreatedIndex",
            "StatusCreatedIndex",
            "StatusCreatedIndex",
            "StatusCreatedIndex",
        ]
        assert [current.kwargs["ScanIndexForward"] for current in table.query.call_args_list] == [
            False,
            False,
            False,
            False,
        ]
        assert [current.kwargs["Limit"] for current in table.query.call_args_list] == [7, 7, 7, 7]

    def test_preserves_legacy_row_without_scope_or_batch_fields(self) -> None:
        legacy = history_row(
            "legacy",
            "generated",
            "2026-09-20T10:00:00Z",
            idea_type="visibility_gap",
            idea_data={"id": "old-idea", "keyword": "Legacy keyword"},
        )

        history, _ = history_for(20, generated=[legacy])

        assert history == [legacy]
        assert "scope" not in history[0]
        assert "batch_id" not in history[0]

    def test_history_route_keeps_existing_response_shape(self) -> None:
        legacy = history_row("legacy", "generated", "2026-09-20T10:00:00Z")
        table = fake_table()
        table.query.side_effect = [
            *status_query_pages(generated=[legacy]),
            {"Count": 1},
        ]
        event = api_gateway_event("GET", "/content-studio/history", query={"limit": "20"})

        status, body = call_api(event, content_studio_resource(content_table=table))

        assert status == 200
        assert body == {
            "history": [legacy],
            "total_count": 1,
            "unviewed_count": 1,
        }


class TestGenerationStatus:
    def test_reports_attempt_count_and_terminal_reason_when_generation_failed(self) -> None:
        row = history_row(
            "failed-content",
            "failed",
            "2026-09-20T10:00:00Z",
            generation_attempts=3,
            generation_terminal_reason="max_attempts_exhausted",
            error_message="Content generation failed after 3 attempts.",
        )
        status, body = call_content_status(_mod, row, "failed-content")

        assert status == 200
        assert body == {
            "id": "failed-content",
            "status": "failed",
            "keyword": "Keyword failed-content",
            "created_at": "2026-09-20T10:00:00Z",
            "updated_at": "2026-09-20T10:00:00Z",
            "has_content": False,
            "content_warning": None,
            "error_message": "Content generation failed after 3 attempts.",
            "generation_attempts": 3,
            "generation_terminal_reason": "max_attempts_exhausted",
        }


class TestUnviewedCount:
    def test_counts_every_paginated_generated_index_page(self) -> None:
        table = fake_table()
        table.query.side_effect = [
            {"Count": 2, "LastEvaluatedKey": {"id": "page-1"}},
            {"Count": 3},
        ]

        with patch.object(_mod, "dynamodb", content_studio_resource(content_table=table)):
            count = _mod.get_unviewed_count()

        assert count == 5
        assert table.query.call_count == 2
        assert table.query.call_args_list[1].kwargs["ExclusiveStartKey"] == {"id": "page-1"}
        table.scan.assert_not_called()

    def test_filters_generated_rows_by_explicit_unviewed_value(self) -> None:
        table = fake_table(query={"Count": 0})

        with patch.object(_mod, "dynamodb", content_studio_resource(content_table=table)):
            _mod.get_unviewed_count()

        request = table.query.call_args.kwargs
        assert request["IndexName"] == "StatusCreatedIndex"
        assert request["FilterExpression"] == "viewed = :viewed"
        assert request["ExpressionAttributeValues"] == {":viewed": False}
        assert request["Select"] == "COUNT"


class TestBatchStatus:
    def test_returns_exact_children_in_manifest_order_with_observed_counts(self) -> None:
        items = [
            history_row(
                "child-2",
                "failed",
                "2099-09-20T10:02:00Z",
                batch_id="batch-1",
                batch_size=2,
                batch_position=2,
                keyword_id="keyword-2",
                error_message="failed",
                generation_attempts=3,
                generation_terminal_reason="max_attempts_exhausted",
            ),
            history_row(
                "child-1",
                "generated",
                "2099-09-20T10:01:00Z",
                batch_id="batch-1",
                batch_size=2,
                batch_position=1,
                keyword_id="keyword-1",
                generated_content={"title": "Ready"},
                generation_attempts=1,
            ),
        ]
        resource, _ = batch_status_resource(
            batch_manifest_item(["child-1", "child-2"]),
            items,
        )
        status, body = call_batch_status(_mod, resource)

        assert status == 200
        assert body == batch_status_body(
            [
                batch_child_status(
                    1,
                    "generated",
                    created_at="2099-09-20T10:01:00Z",
                    updated_at="2099-09-20T10:01:00Z",
                    has_content=True,
                    generation_attempts=1,
                ),
                batch_child_status(
                    2,
                    "failed",
                    created_at="2099-09-20T10:02:00Z",
                    updated_at="2099-09-20T10:02:00Z",
                    error_message="failed",
                    generation_attempts=3,
                    generation_terminal_reason="max_attempts_exhausted",
                ),
            ],
            batch_counts(2, generated=1, failed=1),
        )

    def test_reads_manifest_and_children_with_strong_consistency(self) -> None:
        resource, batch_table = batch_status_resource(batch_manifest_item(["child-1", "child-2"]))
        call_batch_status(_mod, resource)

        batch_table.get_item.assert_called_once_with(
            Key={"batch_id": "batch-1"},
            ConsistentRead=True,
        )
        resource.batch_get_item.assert_called_once_with(
            RequestItems={
                CONTENT_STUDIO_TABLE_NAME: {
                    "Keys": [{"id": "child-1"}, {"id": "child-2"}],
                    "ConsistentRead": True,
                },
            }
        )

    def test_reads_legacy_id_only_manifest_during_rollout(self) -> None:
        manifest = batch_manifest_item(["child-1", "child-2"])
        manifest.pop("children")
        manifest["child_ids"] = ["child-1", "child-2"]
        items = [
            history_row("child-2", "pending", "2099-09-20T10:02:00Z"),
            history_row("child-1", "pending", "2099-09-20T10:01:00Z"),
        ]
        resource, _ = batch_status_resource(manifest, items)

        status, body = call_batch_status(_mod, resource)

        assert status == 200
        assert [child["id"] for child in body["children"]] == ["child-1", "child-2"]
        assert body["counts"]["total"] == 2

    def test_returns_all_children_when_unprocessed_key_succeeds_on_retry(self) -> None:
        items = [
            history_row("child-1", "generated", "2099-09-20T10:01:00Z"),
            history_row("child-2", "pending", "2099-09-20T10:02:00Z"),
        ]
        resource, _ = batch_status_resource(batch_manifest_item(["child-1", "child-2"]))
        resource.batch_get_item.side_effect = [
            {
                "Responses": {CONTENT_STUDIO_TABLE_NAME: [items[1]]},
                "UnprocessedKeys": {
                    CONTENT_STUDIO_TABLE_NAME: {"Keys": [{"id": "child-1"}]},
                },
            },
            {"Responses": {CONTENT_STUDIO_TABLE_NAME: [items[0]]}},
        ]
        with patch("shared.dynamodb_batch.time.sleep") as sleep:
            status, body = call_batch_status(_mod, resource)

        assert status == 200
        assert [child["id"] for child in body["children"]] == ["child-1", "child-2"]
        assert resource.batch_get_item.call_count == 2
        sleep.assert_called_once_with(0.05)

    def test_reports_missing_tombstone_when_manifest_child_is_absent(self) -> None:
        items = [
            history_row("child-3", "pending", "2099-09-20T10:03:00Z"),
            history_row("child-1", "generated", "2099-09-20T10:01:00Z"),
        ]
        resource, _ = batch_status_resource(
            batch_manifest_item(["child-1", "child-2", "child-3"]),
            items,
        )

        status, body = call_batch_status(_mod, resource)

        assert status == 200
        assert body["children"][1] == missing_batch_child(2)
        assert body["counts"] == batch_counts(3, pending=1, generated=1, missing=1)
        assert body["counts"]["total"] == body["batch_size"]

    def test_reports_missing_tombstone_when_every_manifest_child_is_absent(self) -> None:
        resource, _ = batch_status_resource(batch_manifest_item(["child-1"]))

        status, body = call_batch_status(_mod, resource)

        assert status == 200
        assert body == batch_status_body([missing_batch_child(1)], batch_counts(1, missing=1))

    def test_returns_404_when_manifest_is_absent(self) -> None:
        resource, _ = batch_status_resource(None)
        status, body = call_batch_status(_mod, resource, "missing")

        assert status == 404
        assert body == {"error": "Batch not found"}
        resource.batch_get_item.assert_not_called()

    @pytest.mark.parametrize(
        ("operation", "child_reads"),
        [("GetItem", 0), ("BatchGetItem", 1)],
        ids=["manifest-read-fails", "child-read-fails"],
    )
    def test_returns_safe_operational_error_when_storage_read_fails(self, operation: str, child_reads: int) -> None:
        resource, batch_table = batch_status_resource(batch_manifest_item(["child-1"]))
        failing_reads = {"GetItem": batch_table.get_item, "BatchGetItem": resource.batch_get_item}
        failing_reads[operation].side_effect = ClientError(
            {"Error": {"Code": "ProvisionedThroughputExceededException", "Message": "private"}},
            operation,
        )

        status, body = call_batch_status(_mod, resource)

        assert status == 500
        assert body == {"error": "Service temporarily unavailable"}
        assert resource.batch_get_item.call_count == child_reads


class TestBatchChildDeletion:
    def test_preserves_manifest_when_batch_child_is_deleted(self) -> None:
        content_table = fake_table(delete_item={})
        batch_table = fake_table()
        resource = content_studio_resource(
            content_table=content_table,
            batch_table=batch_table,
        )
        event = api_gateway_event(
            "DELETE",
            "/content-studio/child-1",
            path_params={"id": "child-1"},
        )

        status, body = call_api(event, resource)

        assert status == 200
        assert body == {
            "success": True,
            "message": "Content deleted successfully",
        }
        content_table.delete_item.assert_called_once_with(Key={"id": "child-1"})
        batch_table.delete_item.assert_not_called()
