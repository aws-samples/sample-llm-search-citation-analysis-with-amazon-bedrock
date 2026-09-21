"""Durable DynamoDB Stream lifecycle tests for Content Studio generation."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from testing.content_studio_fixtures import (
    CONTENT_STUDIO_TABLE_NAME,
    load_content_studio_module,
    patched_stream_worker,
    pending_recovery_row,
    run_reconcile_worker,
    run_stream_worker,
    stream_insert_event,
    stream_worker_case,
)

_mod = load_content_studio_module("content_studio_stream_worker_under_test")

_GENERATED = {
    "success": True,
    "content": {"title": "Generated title"},
    "raw_content": "Generated body",
    "model": "test-model",
    "competitor_sources_used": 2,
}
_MODEL_FAILURE = {
    "success": False,
    "error": "The model could not generate content.",
    "error_type": "generation",
}
_CLAIM_CONDITION = (
    "(#status = :pending OR "
    "(#status = :generating AND generation_owner = :owner AND "
    "(attribute_not_exists(generation_lease_expires_at) OR "
    "generation_lease_expires_at <= :now))) AND "
    "(attribute_not_exists(generation_attempts) OR "
    "generation_attempts < :max_attempts)"
)


class UnexpectedGenerationError(RuntimeError):
    """An unexpected worker failure used to exercise stream retry behavior."""


def test_persists_generated_result_when_pending_insert_is_processed() -> None:
    run = run_stream_worker(_mod, _GENERATED)

    assert run.response == {"batchItemFailures": []}
    assert run.rows["content-1"]["status"] == "generated"
    assert run.rows["content-1"]["generated_content"] == {"title": "Generated title"}
    assert run.rows["content-1"]["generation_attempts"] == 1


def test_uses_saved_template_snapshot_when_stream_insert_is_processed() -> None:
    resource, rows, _ = stream_worker_case()
    snapshot = {
        **rows["content-1"]["idea_data"],
        "template_id": "template-1",
        "template_name": "Saved template",
        "template_modified": False,
        "prompt_template": "Saved prompt for {scope} and {keywords}.",
    }
    rows["content-1"]["idea_data"] = snapshot
    event = stream_insert_event(rows["content-1"])
    generation = MagicMock(return_value=_GENERATED)

    with patched_stream_worker(_mod, resource, generation):
        _mod.handler(event, None)

    generation.assert_called_once_with(snapshot, {"name": "Test Brand"})


def test_claims_pending_row_with_owner_lease_and_first_attempt() -> None:
    run = run_stream_worker(_mod, _GENERATED, event_id="stable-event-id")

    table = run.resource.Table(CONTENT_STUDIO_TABLE_NAME)
    claim = table.update_item.call_args_list[0].kwargs
    values = claim["ExpressionAttributeValues"]
    assert claim["ConditionExpression"] == _CLAIM_CONDITION
    assert values[":owner"] == "stable-event-id"
    assert values[":max_attempts"] == 3
    assert values[":lease_expires_at"] - values[":now"] == 360


def test_skips_duplicate_delivery_when_first_delivery_generated_content() -> None:
    resource, rows, event = stream_worker_case()
    generation = MagicMock(return_value=_GENERATED)

    with patched_stream_worker(_mod, resource, generation):
        _mod.handler(event, None)
        _mod.handler(event, None)

    generation.assert_called_once_with(
        rows["content-1"]["idea_data"],
        {"name": "Test Brand"},
    )
    assert rows["content-1"]["status"] == "generated"


def test_skips_delivery_when_row_is_terminally_failed() -> None:
    run = run_stream_worker(_mod, _GENERATED, current_status="failed")

    assert run.response == {"batchItemFailures": []}
    assert run.rows["content-1"]["status"] == "failed"
    run.generation.assert_not_called()


def test_returns_row_to_pending_when_processing_crashes_before_attempt_cap() -> None:
    resource, rows, event = stream_worker_case(event_id="retryable-event")
    generation = MagicMock(side_effect=UnexpectedGenerationError("worker crashed"))

    with patched_stream_worker(_mod, resource, generation), pytest.raises(
        UnexpectedGenerationError,
        match="worker crashed",
    ):
        _mod.handler(event, None)

    assert rows["content-1"]["status"] == "pending"
    assert rows["content-1"]["generation_owner"] == "retryable-event"
    assert rows["content-1"]["generation_attempts"] == 1
    assert "generation_lease_expires_at" not in rows["content-1"]


def test_generates_content_when_same_event_retries_after_crash() -> None:
    resource, rows, event = stream_worker_case(event_id="retryable-event")
    generation = MagicMock(
        side_effect=[UnexpectedGenerationError("worker crashed"), _GENERATED]
    )

    with patched_stream_worker(_mod, resource, generation):
        with pytest.raises(UnexpectedGenerationError, match="worker crashed"):
            _mod.handler(event, None)
        result = _mod.handler(event, None)

    assert result == {"batchItemFailures": []}
    assert rows["content-1"]["status"] == "generated"
    assert rows["content-1"]["generation_attempts"] == 2
    assert generation.call_count == 2


def test_resumes_same_owner_when_existing_lease_has_expired() -> None:
    run = run_stream_worker(
        _mod,
        _GENERATED,
        event_id="timed-out-event",
        current_status="generating",
        current_owner="timed-out-event",
        current_attempts=1,
        current_lease_expires_at=1,
    )

    assert run.response == {"batchItemFailures": []}
    assert run.rows["content-1"]["status"] == "generated"
    assert run.rows["content-1"]["generation_attempts"] == 2
    run.generation.assert_called_once_with(
        run.rows["content-1"]["idea_data"],
        {"name": "Test Brand"},
    )


def test_skips_same_owner_retry_when_lease_remains_active() -> None:
    run = run_stream_worker(
        _mod,
        _GENERATED,
        event_id="active-event",
        current_status="generating",
        current_owner="active-event",
        current_attempts=1,
        current_lease_expires_at=9_999_999_999,
    )

    assert run.response == {"batchItemFailures": []}
    assert run.rows["content-1"]["status"] == "generating"
    assert run.rows["content-1"]["generation_attempts"] == 1
    run.generation.assert_not_called()


def test_skips_generation_when_different_event_owns_inflight_row() -> None:
    run = run_stream_worker(
        _mod,
        _GENERATED,
        event_id="new-event",
        current_status="generating",
        current_owner="original-event",
        current_attempts=1,
        current_lease_expires_at=1,
    )

    assert run.response == {"batchItemFailures": []}
    assert run.rows["content-1"]["generation_owner"] == "original-event"
    assert run.rows["content-1"]["generation_attempts"] == 1
    run.generation.assert_not_called()


def test_marks_row_failed_with_reason_when_model_returns_normal_failure() -> None:
    run = run_stream_worker(_mod, _MODEL_FAILURE)

    assert run.response == {"batchItemFailures": []}
    assert run.rows["content-1"]["status"] == "failed"
    assert run.rows["content-1"]["error_message"] == "The model could not generate content."
    assert run.rows["content-1"]["generation_terminal_reason"] == "generation"


def test_terminalizes_row_when_third_unexpected_attempt_crashes() -> None:
    run = run_stream_worker(
        _mod,
        _GENERATED,
        event_id="final-event",
        current_attempts=2,
        generation_side_effect=UnexpectedGenerationError("third crash"),
    )

    assert run.response == {"batchItemFailures": []}
    assert run.rows["content-1"]["status"] == "failed"
    assert run.rows["content-1"]["generation_attempts"] == 3
    assert run.rows["content-1"]["generation_terminal_reason"] == "max_attempts_exhausted"


def test_skips_model_when_pending_row_already_reached_attempt_cap() -> None:
    run = run_stream_worker(
        _mod,
        _GENERATED,
        current_attempts=3,
    )

    assert run.response == {"batchItemFailures": []}
    assert run.rows["content-1"]["status"] == "pending"
    assert run.rows["content-1"]["generation_attempts"] == 3
    run.generation.assert_not_called()


def test_skips_stream_image_when_insert_was_not_pending() -> None:
    run = run_stream_worker(
        _mod,
        _GENERATED,
        event_status="generated",
    )

    assert run.response == {"batchItemFailures": []}
    assert run.rows["content-1"]["status"] == "pending"
    run.generation.assert_not_called()


@pytest.mark.parametrize(
    "transport",
    [None, "dynamodb_stream"],
    ids=["missing", "unversioned"],
)
def test_ignores_insert_when_transport_marker_is_not_exact(transport: str | None) -> None:
    run = run_stream_worker(
        _mod,
        _GENERATED,
        event_transport=transport,
    )

    assert run.response == {"batchItemFailures": []}
    assert run.rows["content-1"]["status"] == "pending"
    run.generation.assert_not_called()


def test_forwards_old_async_event_to_worker_without_running_model() -> None:
    resource, rows, _ = stream_worker_case()
    generation = MagicMock(return_value=_GENERATED)
    lambda_client = MagicMock()
    lambda_client.invoke.return_value = {"StatusCode": 202}
    event = {
        "async_generation": True,
        "content_id": "content-1",
        "idea": rows["content-1"]["idea_data"],
    }
    expected_payload = json.dumps(
        {
            "legacy_generation": True,
            "content_id": "content-1",
            "idea": rows["content-1"]["idea_data"],
        },
        separators=(",", ":"),
    ).encode()

    with (
        patched_stream_worker(_mod, resource, generation),
        patch.object(_mod.boto3, "client", return_value=lambda_client),
    ):
        result = _mod.handler(event, None)

    assert result == {"statusCode": 202, "body": "Legacy generation forwarded"}
    lambda_client.invoke.assert_called_once_with(
        FunctionName="CitationAnalysis-ContentStudioWorker",
        InvocationType="Event",
        Payload=expected_payload,
    )
    generation.assert_not_called()


@pytest.mark.parametrize(
    ("content_id", "idea"),
    [
        ("   ", {"keyword": "Keyword one"}),
        ("content-1", {}),
    ],
    ids=["blank-content-id", "empty-idea"],
)
def test_rejects_invalid_old_async_event_without_invoking_worker(
    content_id: str,
    idea: dict[str, str],
) -> None:
    lambda_client = MagicMock()

    with patch.object(_mod.boto3, "client", return_value=lambda_client):
        result = _mod.handler(
            {"async_generation": True, "content_id": content_id, "idea": idea},
            None,
        )

    assert result == {"statusCode": 400, "body": "Invalid async event"}
    lambda_client.invoke.assert_not_called()


def test_processes_forwarded_legacy_generation_in_worker() -> None:
    resource, rows, _ = stream_worker_case()
    generation = MagicMock(return_value=_GENERATED)
    event = {
        "legacy_generation": True,
        "content_id": "content-1",
        "idea": rows["content-1"]["idea_data"],
    }

    with patched_stream_worker(_mod, resource, generation):
        result = _mod.handler(event, None)

    assert result == {"statusCode": 200, "body": "Generation processing completed"}
    assert rows["content-1"]["status"] == "generated"
    assert rows["content-1"]["generation_owner"] == "legacy:content-1"
    generation.assert_called_once_with(rows["content-1"]["idea_data"], {"name": "Test Brand"})


def test_rejects_forwarded_generation_when_idea_differs_from_saved_row() -> None:
    resource, rows, _ = stream_worker_case()
    generation = MagicMock(return_value=_GENERATED)
    event = {
        "legacy_generation": True,
        "content_id": "content-1",
        "idea": {**rows["content-1"]["idea_data"], "keyword": "Changed"},
    }

    with patched_stream_worker(_mod, resource, generation):
        result = _mod.handler(event, None)

    assert result == {"statusCode": 400, "body": "Invalid generation event"}
    assert rows["content-1"]["status"] == "pending"
    generation.assert_not_called()


def test_dispatches_old_pending_row_without_original_stream_record() -> None:
    row = pending_recovery_row("content-1")
    run = run_reconcile_worker(
        _mod,
        [row],
        [{"Items": [row]}, {"Items": []}],
    )

    assert run.response == {"dispatched": 1, "terminalized": 0}
    run.lambda_client.invoke.assert_called_once_with(
        FunctionName="CitationAnalysis-ContentStudioWorker",
        InvocationType="Event",
        Payload=json.dumps(
            {
                "action": "generate",
                "content_id": "content-1",
                "idea": run.rows["content-1"]["idea_data"],
                "generation_owner": "reconcile:recovery-id",
            },
            separators=(",", ":"),
        ).encode(),
    )
    assert run.table.query.call_count == 2


def test_pages_past_nonmatching_old_rows_to_find_versioned_recovery() -> None:
    row = pending_recovery_row("content-1")
    run = run_reconcile_worker(
        _mod,
        [row],
        [
            {"Items": [], "LastEvaluatedKey": {"id": "old-row"}},
            {"Items": [row]},
            {"Items": []},
        ],
    )

    assert run.response == {"dispatched": 1, "terminalized": 0}
    assert run.table.query.call_args_list[1].kwargs["ExclusiveStartKey"] == {
        "id": "old-row"
    }
    run.lambda_client.invoke.assert_called_once()


def test_persists_next_page_when_bounded_window_contains_only_legacy_rows() -> None:
    row = pending_recovery_row("content-1")
    legacy_pages = [
        {
            "Items": [],
            "LastEvaluatedKey": {
                "status": "pending",
                "created_at": f"2020-01-01T00:00:{index:02d}Z",
                "id": f"legacy-{index}",
            },
        }
        for index in range(10)
    ]
    run = run_reconcile_worker(
        _mod,
        [row],
        [*legacy_pages, {"Items": []}],
    )

    expected_cursor = legacy_pages[-1]["LastEvaluatedKey"]
    assert run.response == {"dispatched": 0, "terminalized": 0}
    assert run.rows[_mod._RECONCILIATION_CURSOR_ID]["pending_cursor"] == (
        expected_cursor
    )
    run.lambda_client.invoke.assert_not_called()


def test_dispatches_versioned_row_when_saved_page_follows_legacy_window() -> None:
    row = pending_recovery_row("content-1")
    cursor = {
        "status": "pending",
        "created_at": "2020-01-01T00:00:09Z",
        "id": "legacy-9",
    }
    cursor_row = {
        "id": _mod._RECONCILIATION_CURSOR_ID,
        "pending_cursor": cursor,
    }
    run = run_reconcile_worker(
        _mod,
        [row, cursor_row],
        [{"Items": [row]}, {"Items": []}],
    )

    assert run.response == {"dispatched": 1, "terminalized": 0}
    assert run.table.query.call_args_list[0].kwargs["ExclusiveStartKey"] == cursor
    assert json.loads(run.lambda_client.invoke.call_args.kwargs["Payload"]) == {
        "action": "generate",
        "content_id": "content-1",
        "idea": row["idea_data"],
        "generation_owner": "reconcile:recovery-id",
    }


def test_dispatches_at_most_ten_recoverable_rows_per_reconcile() -> None:
    pending = [pending_recovery_row(f"content-{index:02d}") for index in range(12)]
    run = run_reconcile_worker(
        _mod,
        pending,
        [{"Items": pending}, {"Items": []}],
    )

    assert run.response == {"dispatched": 10, "terminalized": 0}
    assert run.lambda_client.invoke.call_count == 10


def test_releases_expired_generating_lease_before_recovery_dispatch() -> None:
    row = {
        **pending_recovery_row("content-1"),
        "status": "generating",
        "generation_attempts": 1,
        "generation_owner": "timed-out-owner",
        "generation_lease_expires_at": 1,
    }
    run = run_reconcile_worker(
        _mod,
        [row],
        [{"Items": []}, {"Items": [row]}],
    )

    assert run.response == {"dispatched": 1, "terminalized": 0}
    assert run.rows["content-1"]["status"] == "pending"
    assert "generation_lease_expires_at" not in run.rows["content-1"]
    run.lambda_client.invoke.assert_called_once()


def test_leaves_active_generating_lease_untouched() -> None:
    row = {
        **pending_recovery_row("content-1"),
        "status": "generating",
        "generation_attempts": 1,
        "generation_owner": "active-owner",
        "generation_lease_expires_at": 9_999_999_999,
    }
    run = run_reconcile_worker(
        _mod,
        [row],
        [{"Items": []}, {"Items": [row]}],
    )

    assert run.response == {"dispatched": 0, "terminalized": 0}
    assert run.rows["content-1"]["status"] == "generating"
    run.lambda_client.invoke.assert_not_called()


def test_terminalizes_exhausted_pending_row_without_model_dispatch() -> None:
    row = {**pending_recovery_row("content-1"), "generation_attempts": 3}
    run = run_reconcile_worker(
        _mod,
        [row],
        [{"Items": [row]}, {"Items": []}],
    )

    assert run.response == {"dispatched": 0, "terminalized": 1}
    assert run.rows["content-1"]["status"] == "failed"
    assert run.rows["content-1"]["generation_terminal_reason"] == (
        "max_attempts_exhausted"
    )
    run.lambda_client.invoke.assert_not_called()
