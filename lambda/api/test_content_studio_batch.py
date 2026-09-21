"""Background batch-generation tests for Content Studio."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from shared.content_brief import CREATE_NEW_LANDING_PAGE, DEFAULT_PROMPT_TEMPLATES
from testing.content_brief_fixtures import (
    build_batch_brief,
    build_batch_request,
    content_brief_template_item,
    mixed_group_keyword_rows,
)
from testing.content_studio_fixtures import (
    active_keyword_rows,
    content_studio_resource,
    failing_batch_manifest_table,
    load_content_studio_module,
    selected_keyword_scope,
    stateful_batch_table,
    stateful_content_table,
    template_batch_repair_case,
)
from testing.dynamodb_stubs import fake_table
from testing.events import api_gateway_event, parse_response

_mod = load_content_studio_module("content_studio_batch_under_test")


def batch_event(request: dict[str, object]) -> dict[str, object]:
    return api_gateway_event("POST", "/content-studio/generate-batch", body=request)


def run_batch(
    request: dict[str, object],
    *,
    content_table: MagicMock,
    keywords: list[dict[str, object]] | None = None,
    batch_table: MagicMock | None = None,
    template_table: MagicMock | None = None,
) -> tuple[int, dict[str, Any]]:
    resource = content_studio_resource(
        content_table=content_table,
        keyword_items=keywords or active_keyword_rows(2),
        batch_table=batch_table,
        template_table=template_table,
    )
    with patch.object(_mod, "dynamodb", resource):
        return parse_response(_mod._api_handler(batch_event(request), None))


class TestBatchValidation:
    @pytest.mark.parametrize("count", [1, 10])
    def test_accepts_batch_when_scope_resolves_within_boundary(self, count: int) -> None:
        table, rows = stateful_content_table()
        request = build_batch_request(scope=selected_keyword_scope(count))

        status, body = run_batch(request, content_table=table, keywords=active_keyword_rows(count))

        assert status == 202
        assert body["accepted_count"] == count
        assert body["failed_count"] == 0
        assert len(rows) == count

    def test_rejects_batch_when_scope_resolves_to_eleven_keywords(self) -> None:
        table, rows = stateful_content_table()
        request = build_batch_request(scope=selected_keyword_scope(11))

        status, body = run_batch(
            request,
            content_table=table,
            keywords=active_keyword_rows(11),
        )

        assert status == 400
        assert body == {
            "error": "scope must resolve to at most 10 active keywords",
            "field": "scope",
        }
        assert rows == {}

    @pytest.mark.parametrize(
        ("scope", "expected_field"),
        [
            ({"mode": "keywords", "keyword_ids": []}, "scope.keyword_ids"),
            ({"mode": "keywords", "keyword_ids": ["missing"]}, "scope.keyword_ids"),
            ({"mode": "groups", "group_ids": ["group-1", "group-2"]}, "scope.group_ids"),
            ({"mode": "all"}, "scope.mode"),
        ],
        ids=["empty", "missing", "multiple-groups", "all"],
    )
    def test_rejects_invalid_scope_without_queue_side_effects(
        self, scope: dict[str, object], expected_field: str
    ) -> None:
        table, rows = stateful_content_table()
        request = build_batch_request(scope=scope)

        status, body = run_batch(
            request,
            content_table=table,
            keywords=active_keyword_rows(1),
        )

        assert status == 400
        assert body["field"] == expected_field
        assert rows == {}

    @pytest.mark.parametrize(
        "prompt_template",
        ["Use {unknown}", "Use {group} and {keywords}"],
        ids=["unknown-placeholder", "group-placeholder-on-keyword-scope"],
    )
    def test_rejects_invalid_prompt_without_queue_side_effects(self, prompt_template: str) -> None:
        table, rows = stateful_content_table()
        request = build_batch_request(
            brief={
                "content_angle": CREATE_NEW_LANDING_PAGE,
                "landing_url": "",
                "current_copy": "",
                "prompt_template": prompt_template,
                "output_language": "English",
            }
        )

        status, body = run_batch(
            request,
            content_table=table,
        )

        assert status == 400
        assert body["field"] == "prompt_template"
        assert rows == {}


class TestBatchCanonicalChildren:
    def test_uses_sha256_of_batch_and_keyword_for_each_child_idea_id(self) -> None:
        table, rows = stateful_content_table()
        request = build_batch_request(batch_id="stable-batch")

        status, _ = run_batch(request, content_table=table, keywords=active_keyword_rows(2))

        expected = {hashlib.sha256(f"stable-batch:keyword-{index}".encode()).hexdigest() for index in (1, 2)}
        assert status == 202
        assert {row["idea_id"] for row in rows.values()} == expected

    def test_returns_identical_content_ids_when_same_batch_is_created_independently(self) -> None:
        first_table, _ = stateful_content_table()
        second_table, _ = stateful_content_table()
        request = build_batch_request(batch_id="stable-batch")

        _, first = run_batch(
            request,
            content_table=first_table,
        )
        _, second = run_batch(
            request,
            content_table=second_table,
        )

        assert [child["id"] for child in first["children"]] == [child["id"] for child in second["children"]]
        assert len({child["id"] for child in first["children"]}) == 2

    def test_persists_exact_manifest_before_creating_children(self) -> None:
        batch_table, manifests = stateful_batch_table()
        manifest_ids_seen_by_child_put: list[list[str]] = []

        def capture_manifest(_item: dict[str, Any]) -> None:
            manifest_ids_seen_by_child_put.append(
                [child["id"] for child in manifests["batch-1"]["children"]]
            )

        content_table, content_rows = stateful_content_table(before_put=capture_manifest)
        with patch.object(_mod, "get_timestamp", return_value="2026-09-20T10:00:00Z"):
            status, _ = run_batch(
                build_batch_request(),
                content_table=content_table,
                batch_table=batch_table,
            )

        ordered_rows = sorted(
            content_rows.values(),
            key=lambda row: row["batch_position"],
        )
        child_ids = [row["id"] for row in ordered_rows]
        request_hash = ordered_rows[0]["batch_request_hash"]
        descriptors = [
            {
                "id": row["id"],
                "idea_id": row["idea_id"],
                "keyword_id": row["keyword_id"],
                "keyword": row["keyword"],
                "position": row["batch_position"],
            }
            for row in ordered_rows
        ]
        manifest = manifests["batch-1"]
        assert (status, set(manifest)) == (
            202,
            {
                "batch_id",
                "request_payload_hash",
                "canonical_brief",
                "children",
                "batch_size",
                "created_at",
                "updated_at",
            },
        )
        assert {
            "request_payload_hash": manifest["request_payload_hash"],
            "children": manifest["children"],
        } == {
            "request_payload_hash": request_hash,
            "children": descriptors,
        }
        assert manifest["canonical_brief"] == {
            "id": "batch-1",
            "type": "group_brief",
            "priority": "medium",
            "title": "Group Brief: 2 selected keywords",
            "description": "Generate a complete landing page from 2 selected active keywords.",
            "keyword": "2 selected keywords",
            "source": "group_brief",
            "actionable": True,
            "content_angle": CREATE_NEW_LANDING_PAGE,
            "scope": {
                "mode": "keywords",
                "keyword_ids": ["keyword-1", "keyword-2"],
            },
            "scope_label": "2 selected keywords",
            "keyword_ids": ["keyword-1", "keyword-2"],
            "keywords": ["Keyword 01", "Keyword 02"],
            "landing_url": "",
            "current_copy": "",
            "prompt_template": DEFAULT_PROMPT_TEMPLATES[CREATE_NEW_LANDING_PAGE],
            "output_language": "English",
            "competitor_urls": [],
        }
        assert manifest_ids_seen_by_child_put == [child_ids, child_ids]

    def test_stores_batch_dimensions_at_row_top_level(self) -> None:
        table, rows = stateful_content_table()

        run_batch(build_batch_request(), content_table=table, keywords=active_keyword_rows(2))

        ordered = sorted(rows.values(), key=lambda row: row["batch_position"])
        assert [row["batch_id"] for row in ordered] == ["batch-1", "batch-1"]
        assert [row["batch_size"] for row in ordered] == [2, 2]
        assert [row["batch_position"] for row in ordered] == [1, 2]
        assert [row["keyword_id"] for row in ordered] == ["keyword-1", "keyword-2"]

    def test_gives_each_child_one_authoritative_selected_keyword_scope(self) -> None:
        table, rows = stateful_content_table()

        run_batch(build_batch_request(), content_table=table, keywords=active_keyword_rows(2))

        ideas = [row["idea_data"] for row in sorted(rows.values(), key=lambda row: row["batch_position"])]
        assert [idea["scope"] for idea in ideas] == [
            {"mode": "keywords", "keyword_ids": ["keyword-1"]},
            {"mode": "keywords", "keyword_ids": ["keyword-2"]},
        ]
        assert [idea["keywords"] for idea in ideas] == [["Keyword 01"], ["Keyword 02"]]

    def test_group_batch_resolves_all_active_members_before_child_queueing(self) -> None:
        table, rows = stateful_content_table()
        grouped = mixed_group_keyword_rows()
        request = build_batch_request(scope={"mode": "groups", "group_ids": ["group-1"]})

        status, body = run_batch(request, content_table=table, keywords=grouped)

        assert status == 202
        assert body["batch_size"] == 2
        assert [row["keyword"] for row in sorted(rows.values(), key=lambda row: row["batch_position"])] == [
            "Alpha",
            "Beta",
        ]


class TestBatchManifestFailures:
    @pytest.mark.parametrize(
        "failure_stage",
        ["write", "read"],
        ids=["manifest-write", "conflicting-manifest-read"],
    )
    def test_returns_safe_operational_error_when_manifest_storage_fails(
        self,
        failure_stage: str,
    ) -> None:
        content_table, content_rows = stateful_content_table()

        status, body = run_batch(
            build_batch_request(),
            content_table=content_table,
            batch_table=failing_batch_manifest_table(failure_stage),
        )

        assert status == 500
        assert body == {"error": "Service temporarily unavailable"}
        assert content_rows == {}


class TestBatchIdempotency:
    def test_same_batch_retry_after_five_minutes_returns_existing_children(self) -> None:
        table, rows = stateful_content_table()
        batch_table, _ = stateful_batch_table()
        request = build_batch_request(batch_id="stable-batch")
        early = datetime(2026, 9, 20, 10, 0, tzinfo=UTC)
        later = datetime(2026, 9, 20, 10, 30, tzinfo=UTC)
        resource = content_studio_resource(
            content_table=table,
            keyword_items=active_keyword_rows(2),
            batch_table=batch_table,
        )

        with (
            patch.object(_mod, "dynamodb", resource),
            patch.object(_mod, "utc_now", return_value=early),
        ):
            first = parse_response(_mod._api_handler(batch_event(request), None))
        with (
            patch.object(_mod, "dynamodb", resource),
            patch.object(_mod, "utc_now", return_value=later),
        ):
            second = parse_response(_mod._api_handler(batch_event(request), None))

        assert first[1]["accepted_count"] == 2
        assert second[1]["existing_count"] == 2
        assert len(rows) == 2

    def test_existing_batch_children_are_counted_without_new_rows(self) -> None:
        table, rows = stateful_content_table()
        batch_table, _ = stateful_batch_table()
        request = build_batch_request()

        run_batch(
            request,
            content_table=table,
            batch_table=batch_table,
        )
        _, retry_body = run_batch(
            request,
            content_table=table,
            batch_table=batch_table,
        )

        assert retry_body["accepted_count"] == 0
        assert retry_body["existing_count"] == 2
        assert retry_body["failed_count"] == 0
        assert len(rows) == 2

    def test_recreates_only_missing_child_when_same_batch_is_retried(self) -> None:
        table, rows = stateful_content_table()
        batch_table, manifests = stateful_batch_table()
        request = build_batch_request()

        _, first = run_batch(
            request,
            content_table=table,
            batch_table=batch_table,
        )
        missing_id = first["children"][0]["id"]
        rows.pop(missing_id)
        _, retry = run_batch(
            request,
            content_table=table,
            batch_table=batch_table,
        )

        manifest_ids = [child["id"] for child in manifests["batch-1"]["children"]]
        assert retry["accepted_count"] == 1
        assert retry["existing_count"] == 1
        assert len(rows) == 2
        assert manifest_ids == [child["id"] for child in first["children"]]


class TestBatchDurableAcceptance:
    def test_reports_zero_attempts_when_batch_children_are_newly_accepted(self) -> None:
        table, _ = stateful_content_table()

        _, body = run_batch(
            build_batch_request(),
            content_table=table,
            keywords=active_keyword_rows(2),
        )

        assert [
            {
                "generation_attempts": child["generation_attempts"],
                "generation_terminal_reason": child["generation_terminal_reason"],
            }
            for child in body["children"]
        ] == [
            {"generation_attempts": 0, "generation_terminal_reason": None},
            {"generation_attempts": 0, "generation_terminal_reason": None},
        ]

    def test_returns_all_children_accepted_after_durable_inserts(self) -> None:
        table, rows = stateful_content_table()
        request = build_batch_request(scope=selected_keyword_scope(3))

        status, body = run_batch(
            request,
            content_table=table,
            keywords=active_keyword_rows(3),
        )

        assert status == 202
        assert (body["accepted_count"], body["existing_count"], body["failed_count"]) == (3, 0, 0)
        assert [row["status"] for row in sorted(rows.values(), key=lambda row: row["batch_position"])] == [
            "pending",
            "pending",
            "pending",
        ]

    def test_counts_existing_failed_rows_without_dispatch_failure_semantics(self) -> None:
        table, rows = stateful_content_table()
        batch_table, _ = stateful_batch_table()
        request = build_batch_request()
        run_batch(request, content_table=table, batch_table=batch_table)
        for row in rows.values():
            row["status"] = "failed"
            row["error_message"] = "Model failure"

        status, body = run_batch(
            request,
            content_table=table,
            batch_table=batch_table,
        )

        assert status == 202
        assert (body["accepted_count"], body["existing_count"], body["failed_count"]) == (0, 2, 0)
        assert [child["status"] for child in body["children"]] == ["failed", "failed"]

    def test_accepted_and_existing_counts_always_equal_batch_size(self) -> None:
        table, rows = stateful_content_table()
        batch_table, _ = stateful_batch_table()
        request = build_batch_request()
        _, first = run_batch(request, content_table=table, batch_table=batch_table)
        rows.pop(first["children"][0]["id"])

        status, body = run_batch(request, content_table=table, batch_table=batch_table)

        assert status == 202
        assert body["accepted_count"] == 1
        assert body["existing_count"] == 1
        assert body["accepted_count"] + body["existing_count"] == body["batch_size"]


class TestBatchTemplateSnapshot:
    def test_snapshots_template_provenance_in_every_child(self) -> None:
        table, rows = stateful_content_table()
        saved = {
            "id": "template-1",
            "name": "Saved template",
            "description": "",
            "content_angle": CREATE_NEW_LANDING_PAGE,
            "prompt_template": DEFAULT_PROMPT_TEMPLATES[CREATE_NEW_LANDING_PAGE],
            "builtin": False,
            "created_by": "writer@example.com",
            "created_at": "2026-09-20T10:00:00Z",
            "updated_at": "2026-09-20T10:00:00Z",
        }
        template_table = fake_table(get_item={"Item": saved})
        brief = {
            "content_angle": CREATE_NEW_LANDING_PAGE,
            "landing_url": "",
            "current_copy": "",
            "template_id": "template-1",
            "prompt_template": "Custom {scope} {keywords}",
            "output_language": "English",
        }

        status, _ = run_batch(
            build_batch_request(brief=brief),
            content_table=table,
            template_table=template_table,
        )

        snapshots = [row["idea_data"] for row in rows.values()]
        assert status == 202
        assert {snapshot["template_id"] for snapshot in snapshots} == {"template-1"}
        assert {snapshot["template_name"] for snapshot in snapshots} == {"Saved template"}
        assert {snapshot["template_modified"] for snapshot in snapshots} == {True}


class TestBatchRequestIdentity:
    @pytest.mark.parametrize(
        "changed_request",
        [
            build_batch_request(
                batch_id="stable-batch",
                brief=build_batch_brief(prompt_template="Changed prompt for {scope} and {keywords}"),
            ),
            build_batch_request(
                batch_id="stable-batch",
                scope={"mode": "keywords", "keyword_ids": ["keyword-3"]},
            ),
        ],
        ids=["changed-prompt", "changed-scope"],
    )
    def test_rejects_reused_batch_id_when_canonical_request_differs(self, changed_request: dict[str, object]) -> None:
        table, _ = stateful_content_table()
        batch_table, _ = stateful_batch_table()
        original = build_batch_request(batch_id="stable-batch")

        run_batch(
            original,
            content_table=table,
            batch_table=batch_table,
            keywords=active_keyword_rows(3),
        )
        child_puts_before_conflict = table.put_item.call_count
        status, body = run_batch(
            changed_request,
            content_table=table,
            batch_table=batch_table,
            keywords=active_keyword_rows(3),
        )

        assert status == 409
        assert body == {
            "error": "batch_id has already been used for a different batch request",
            "field": "batch_id",
        }
        assert table.put_item.call_count == child_puts_before_conflict

    @pytest.mark.parametrize(
        ("field_name", "invalid_value"),
        [
            ("children", [{"id": "unexpected-child"}]),
            ("batch_size", 3),
            ("canonical_brief", {"id": "batch-1"}),
        ],
        ids=["children", "batch-size", "canonical-brief"],
    )
    def test_returns_safe_error_when_matching_hash_manifest_dimensions_differ(
        self,
        field_name: str,
        invalid_value: object,
    ) -> None:
        table, _ = stateful_content_table()
        batch_table, manifests = stateful_batch_table()
        request = build_batch_request()
        run_batch(
            request,
            content_table=table,
            batch_table=batch_table,
        )
        child_puts_before_retry = table.put_item.call_count
        manifests["batch-1"][field_name] = invalid_value

        status, body = run_batch(
            request,
            content_table=table,
            batch_table=batch_table,
        )

        assert status == 500
        assert body == {"error": "Service temporarily unavailable"}
        assert table.put_item.call_count == child_puts_before_retry


def test_group_batch_child_snapshots_exact_keyword_display_fields() -> None:
    table, rows = stateful_content_table()
    request = build_batch_request(scope={"mode": "groups", "group_ids": ["group-1"]})

    run_batch(
        request,
        content_table=table,
        keywords=mixed_group_keyword_rows(),
    )

    first = min(rows.values(), key=lambda row: row["batch_position"])["idea_data"]
    assert first["title"] == "Group Brief: Alpha"
    assert first["description"] == ("Generate a complete landing page from 1 selected active keyword.")
    assert first["scope_label"] == "Alpha"



class TestImmutableBatchRepair:
    def test_repairs_missing_child_when_saved_template_was_deleted(self) -> None:
        repair = template_batch_repair_case()
        _, first = run_batch(
            repair.request,
            content_table=repair.content_table,
            batch_table=repair.batch_table,
            template_table=repair.template_table,
        )
        missing_id = first["children"][0]["id"]
        saved_snapshot = repair.rows.pop(missing_id)["idea_data"]
        repair.template_table.get_item.reset_mock()
        repair.template_table.get_item.return_value = {}

        status, retry = run_batch(
            repair.request,
            content_table=repair.content_table,
            batch_table=repair.batch_table,
            template_table=repair.template_table,
        )

        assert status == 202
        assert retry["accepted_count"] == 1
        assert repair.rows[missing_id]["idea_data"] == saved_snapshot
        repair.template_table.get_item.assert_not_called()

    def test_repairs_missing_child_when_saved_template_was_edited(self) -> None:
        repair = template_batch_repair_case(
            content_brief_template_item(
                name="Original template",
                prompt_template="Original prompt for {scope} and {keywords}.",
            )
        )
        _, first = run_batch(
            repair.request,
            content_table=repair.content_table,
            batch_table=repair.batch_table,
            template_table=repair.template_table,
        )
        missing_id = first["children"][1]["id"]
        repair.rows.pop(missing_id)
        repair.template_table.get_item.reset_mock()
        repair.template_table.get_item.return_value = {
            "Item": content_brief_template_item(
                name="Edited template",
                prompt_template="Edited prompt for {scope} and {keywords}.",
            )
        }

        status, _ = run_batch(
            repair.request,
            content_table=repair.content_table,
            batch_table=repair.batch_table,
            template_table=repair.template_table,
        )

        assert status == 202
        assert repair.rows[missing_id]["idea_data"]["template_name"] == "Original template"
        assert repair.rows[missing_id]["idea_data"]["prompt_template"] == (
            "Original prompt for {scope} and {keywords}."
        )
        repair.template_table.get_item.assert_not_called()

    def test_repairs_missing_child_when_group_membership_changed(self) -> None:
        content_table, rows = stateful_content_table()
        batch_table, _ = stateful_batch_table()
        request = build_batch_request(
            scope={"mode": "groups", "group_ids": ["group-1"]}
        )
        _, first = run_batch(
            request,
            content_table=content_table,
            batch_table=batch_table,
            keywords=mixed_group_keyword_rows(),
        )
        missing_id = first["children"][0]["id"]
        saved_snapshot = rows.pop(missing_id)["idea_data"]

        status, retry = run_batch(
            request,
            content_table=content_table,
            batch_table=batch_table,
            keywords=active_keyword_rows(1),
        )

        assert status == 202
        assert retry["accepted_count"] == 1
        assert rows[missing_id]["idea_data"] == saved_snapshot
        assert rows[missing_id]["keyword"] == "Alpha"

    def test_rejects_hash_mismatch_without_template_or_child_side_effects(self) -> None:
        content_table, _ = stateful_content_table()
        batch_table, _ = stateful_batch_table()
        template_table = fake_table(get_item={"Item": content_brief_template_item()})
        original_brief = build_batch_brief(template_id="template-1")
        original_brief.pop("prompt_template")
        original = build_batch_request(brief=original_brief)
        run_batch(
            original,
            content_table=content_table,
            batch_table=batch_table,
            template_table=template_table,
        )
        child_puts_before_conflict = content_table.put_item.call_count
        template_table.get_item.reset_mock()
        changed = build_batch_request(
            brief=build_batch_brief(
                template_id="template-1",
                prompt_template="Changed prompt for {scope} and {keywords}.",
            )
        )

        status, body = run_batch(
            changed,
            content_table=content_table,
            batch_table=batch_table,
            template_table=template_table,
        )

        assert status == 409
        assert body["field"] == "batch_id"
        assert content_table.put_item.call_count == child_puts_before_conflict
        template_table.get_item.assert_not_called()

    def test_rejects_canonical_snapshot_when_serialized_size_exceeds_bound(self) -> None:
        content_table, rows = stateful_content_table()
        batch_table, _ = stateful_batch_table()
        oversized = {
            "id": "batch-1",
            "keyword_ids": ["keyword-1"],
            "keywords": ["Keyword 01"],
            "oversized": "x" * (64 * 1024),
        }

        with patch.object(_mod, "_batch_request_idea", return_value=(oversized, None)):
            status, body = run_batch(
                build_batch_request(),
                content_table=content_table,
                batch_table=batch_table,
            )

        assert status == 400
        assert body == {
            "error": "brief expands beyond the safe batch snapshot limit",
            "field": "brief",
        }
        assert rows == {}
        batch_table.put_item.assert_not_called()
