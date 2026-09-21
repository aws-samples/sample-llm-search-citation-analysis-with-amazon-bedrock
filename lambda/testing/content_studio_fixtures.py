"""Fixtures for Content Studio handlers, tables, scopes, and API events."""

from __future__ import annotations

import os
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any
from unittest.mock import MagicMock, patch

from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError

from shared.content_brief import CREATE_NEW_LANDING_PAGE
from testing.content_brief_fixtures import (
    active_keyword,
    build_batch_brief,
    build_batch_request,
    build_scoped_content_brief,
    content_brief_template_item,
)
from testing.dynamodb_stubs import conditional_check_failure, fake_dynamodb_resource, fake_table
from testing.env import setdefault_env
from testing.events import api_gateway_event, parse_response
from testing.module_loader import load_handler_module

CONTENT_STUDIO_TABLE_NAME = "test-content-studio"
CONTENT_BRIEF_BATCHES_TABLE_NAME = "test-content-brief-batches"
CONTENT_BRIEF_TEMPLATES_TABLE_NAME = "test-content-brief-templates"
KEYWORDS_TABLE_NAME = "test-keywords"
KEYWORD_GROUPS_TABLE_NAME = "test-keyword-groups"

_CONTENT_STUDIO_ENVIRONMENT = {
    "DYNAMODB_TABLE_SEARCH_RESULTS": "test-search",
    "DYNAMODB_TABLE_CRAWLED_CONTENT": "test-crawled",
    "DYNAMODB_TABLE_CONTENT_STUDIO": CONTENT_STUDIO_TABLE_NAME,
    "DYNAMODB_TABLE_CONTENT_BRIEF_BATCHES": CONTENT_BRIEF_BATCHES_TABLE_NAME,
    "DYNAMODB_TABLE_CONTENT_BRIEF_TEMPLATES": CONTENT_BRIEF_TEMPLATES_TABLE_NAME,
    "DYNAMODB_TABLE_KEYWORDS": KEYWORDS_TABLE_NAME,
    "DYNAMODB_TABLE_KEYWORD_GROUPS": KEYWORD_GROUPS_TABLE_NAME,
    "CONTENT_STUDIO_WORKER_FUNCTION_NAME": "CitationAnalysis-ContentStudioWorker",
}
_STREAM_SERIALIZER = TypeSerializer()


def load_content_studio_module(module_name: str) -> Any:
    """Load the hyphenated handler under an isolated name with its required env."""
    setdefault_env(_CONTENT_STUDIO_ENVIRONMENT)
    api_directory = os.path.join(os.path.dirname(__file__), "..", "api")
    return load_handler_module(api_directory, "content-studio.py", module_name)


@contextmanager
def patched_content_studio(
    module: Any,
    resource: MagicMock,
) -> Iterator[None]:
    """Patch one loaded handler's DynamoDB resource."""
    with patch.object(module, "dynamodb", resource):
        yield


def _stateful_conditional_table(
    key_name: str,
    before_put: Callable[[dict[str, Any]], None] | None = None,
) -> tuple[MagicMock, dict[str, dict[str, Any]]]:
    rows: dict[str, dict[str, Any]] = {}
    table = MagicMock()

    def put_item(*, Item: dict[str, Any], ConditionExpression: str) -> dict[str, Any]:
        assert ConditionExpression == f"attribute_not_exists({key_name})"
        if before_put is not None:
            before_put(Item)
        key = str(Item[key_name])
        if key in rows:
            raise conditional_check_failure("PutItem")
        rows[key] = Item
        return {}

    def get_item(*, Key: Mapping[str, str], **_kwargs: object) -> dict[str, Any]:
        item = rows.get(Key[key_name])
        return {"Item": item} if item is not None else {}

    table.put_item.side_effect = put_item
    table.get_item.side_effect = get_item
    return table, rows


def _claim_condition_allows(
    item: Mapping[str, Any],
    values: Mapping[str, Any],
) -> bool:
    status = item.get("status")
    owner_matches = item.get("generation_owner") == values.get(":owner")
    lease = item.get("generation_lease_expires_at")
    lease_available = lease is None or int(lease) <= int(values[":now"])
    available = status == "pending" or (
        status == "generating" and owner_matches and lease_available
    )
    attempts = int(item.get("generation_attempts", 0))
    return available and attempts < int(values[":max_attempts"])


def _owner_condition_allows(
    item: Mapping[str, Any],
    condition: str | None,
    values: Mapping[str, Any],
) -> bool:
    if condition is None:
        return True
    status = item.get("status")
    owner_matches = item.get("generation_owner") == values.get(":owner")
    is_claim = "#status = :pending OR" in condition
    if is_claim and not _claim_condition_allows(item, values):
        return False
    if "#status = :observed" in condition and status != values.get(":observed"):
        return False
    if (
        not is_claim
        and "#status = :generating" in condition
        and (status != "generating" or not owner_matches)
    ):
        return False
    if (
        "generation_attempts >= :max_attempts" in condition
        and int(item.get("generation_attempts", 0)) < int(values[":max_attempts"])
    ):
        return False
    if (
        "generation_lease_expires_at = :lease_expires_at" in condition
        and item.get("generation_lease_expires_at") != values.get(":lease_expires_at")
    ):
        return False
    return is_claim or "generation_owner = :owner" not in condition or owner_matches


def _apply_reconciliation_cursor_update(
    item: dict[str, Any],
    update_expression: str,
    values: Mapping[str, Any],
) -> None:
    for field_name in ("pending_cursor", "generating_cursor"):
        value_name = f":{field_name}"
        if value_name in values and f"#{field_name} = {value_name}" in update_expression:
            item[field_name] = values[value_name]


def _apply_stateful_update(
    item: dict[str, Any],
    update_expression: str,
    values: Mapping[str, Any],
) -> None:
    for value_name in (":status", ":generating", ":pending", ":failed"):
        if f"#status = {value_name}" in update_expression:
            item["status"] = values[value_name]
            break
    owner = values.get(":owner")
    if owner is not None and "generation_owner" in update_expression:
        item["generation_owner"] = owner
    if "generation_attempts = if_not_exists" in update_expression:
        item["generation_attempts"] = int(item.get("generation_attempts", 0)) + int(
            values[":one"]
        )
    if ":lease_expires_at" in values and "generation_lease_expires_at =" in update_expression:
        item["generation_lease_expires_at"] = values[":lease_expires_at"]
    if ":updated_at" in values:
        item["updated_at"] = values[":updated_at"]
    if ":content" in values:
        item["generated_content"] = values[":content"]
        item["raw_content"] = values[":raw"]
        item["model"] = values[":model"]
        item["competitor_sources_used"] = values[":sources"]
    if ":error" in values:
        item["error_message"] = values[":error"]
    if ":reason" in values:
        item["generation_terminal_reason"] = values[":reason"]
    _apply_reconciliation_cursor_update(item, update_expression, values)
    for field_name in (
        "error_message",
        "generation_terminal_reason",
        "generation_lease_expires_at",
        "pending_cursor",
        "generating_cursor",
    ):
        remove_clause = update_expression.partition(" REMOVE ")[2]
        if field_name in remove_clause:
            item.pop(field_name, None)


def stateful_content_table(
    *,
    before_put: Callable[[dict[str, Any]], None] | None = None,
) -> tuple[MagicMock, dict[str, dict[str, Any]]]:
    """Return a conditional table that models queue and owner transitions."""
    table, rows = _stateful_conditional_table("id", before_put)

    def update_item(
        *,
        Key: Mapping[str, str],
        UpdateExpression: str,
        ExpressionAttributeValues: Mapping[str, Any],
        ConditionExpression: str | None = None,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        assert UpdateExpression.startswith("SET ")
        item = rows.get(Key["id"], {"id": Key["id"]})
        if not _owner_condition_allows(item, ConditionExpression, ExpressionAttributeValues):
            raise conditional_check_failure("UpdateItem")
        rows[Key["id"]] = item
        _apply_stateful_update(item, UpdateExpression, ExpressionAttributeValues)
        return {"Attributes": item}

    table.update_item.side_effect = update_item
    return table, rows


def stateful_batch_table() -> tuple[MagicMock, dict[str, dict[str, Any]]]:
    """Return a conditional-put table backed by durable batch manifests."""
    return _stateful_conditional_table("batch_id")


def failing_batch_manifest_table(failure_stage: str) -> MagicMock:
    """Return a manifest table that fails its write or conflict read."""
    operation = "PutItem" if failure_stage == "write" else "GetItem"
    storage_error = ClientError(
        {
            "Error": {
                "Code": "ProvisionedThroughputExceededException",
                "Message": "private",
            }
        },
        operation,
    )
    table = fake_table()
    if failure_stage == "write":
        table.put_item.side_effect = storage_error
    else:
        table.put_item.side_effect = conditional_check_failure("PutItem")
        table.get_item.side_effect = storage_error
    return table


def content_studio_resource(
    *,
    content_table: MagicMock,
    keyword_items: list[dict[str, object]] | None = None,
    group_item: dict[str, object] | None = None,
    batch_table: MagicMock | None = None,
    template_table: MagicMock | None = None,
) -> MagicMock:
    """Return the named tables opened by Content Studio request paths."""
    groups = fake_table(get_item={"Item": group_item or {"id": "group-1", "name": "Authoritative Group"}})
    keywords = fake_table(query={"Items": keyword_items or []})
    return fake_dynamodb_resource(
        by_name={
            CONTENT_STUDIO_TABLE_NAME: content_table,
            CONTENT_BRIEF_BATCHES_TABLE_NAME: batch_table or fake_table(get_item={}),
            CONTENT_BRIEF_TEMPLATES_TABLE_NAME: template_table or fake_table(get_item={}),
            KEYWORDS_TABLE_NAME: keywords,
            KEYWORD_GROUPS_TABLE_NAME: groups,
        }
    )


def content_template_resource(
    template_table: MagicMock,
    *,
    content_table: MagicMock | None = None,
) -> MagicMock:
    """Return tables for template routes and one-keyword generation snapshots."""
    return content_studio_resource(
        content_table=content_table or fake_table(),
        keyword_items=[active_keyword("keyword-1", "Authoritative keyword", group_ids={"group-1"})],
        template_table=template_table,
    )


def content_template_event(
    method: str,
    *,
    body: dict[str, object] | None = None,
    template_id: str | None = None,
) -> dict[str, Any]:
    """Build one templates collection or item request."""
    collection_path = "/content-studio/templates"
    return api_gateway_event(
        method,
        collection_path if template_id is None else f"{collection_path}/{template_id}",
        body=body,
        path_params=None if template_id is None else {"id": template_id},
        claims={"cognito:username": "writer@example.com"},
    )


def valid_content_template_body(**overrides: object) -> dict[str, object]:
    """Return a valid saved-template request body."""
    body: dict[str, object] = {
        "name": "My landing template",
        "description": "A reusable template",
        "content_angle": CREATE_NEW_LANDING_PAGE,
        "prompt_template": "Write for {brand} in {scope} using {keywords}.",
    }
    body.update(overrides)
    return body


def content_generation_event(idea: dict[str, object]) -> dict[str, Any]:
    """Build a single Content Studio generation request."""
    return api_gateway_event("POST", "/content-studio/generate", body={"idea": idea})


def queue_content_for_test(
    module: Any,
    idea: Mapping[str, object],
    content_table: MagicMock,
) -> tuple[int, Any]:
    """Queue one legacy idea through the request path."""
    resource = content_studio_resource(content_table=content_table)
    with patched_content_studio(module, resource):
        event = content_generation_event(dict(idea))
        return parse_response(module._generate_content(event, None))


def stream_insert_event(
    item: dict[str, Any],
    *,
    event_id: str = "stream-event-1",
    event_name: str = "INSERT",
) -> dict[str, Any]:
    """Build one DynamoDB stream event with a typed NewImage."""
    return {
        "Records": [
            {
                "eventID": event_id,
                "eventName": event_name,
                "dynamodb": {
                    "NewImage": {
                        name: _STREAM_SERIALIZER.serialize(value)
                        for name, value in item.items()
                    }
                },
            }
        ]
    }


def stream_worker_case(
    *,
    event_id: str = "stream-event-1",
    current_status: str = "pending",
    current_owner: str | None = None,
    current_attempts: int = 0,
    current_lease_expires_at: int | None = None,
) -> tuple[MagicMock, dict[str, dict[str, Any]], dict[str, Any]]:
    """Return stateful storage plus the original pending INSERT event."""
    pending = {
        "id": "content-1",
        "idea_id": "idea-1",
        "keyword": "Keyword one",
        "idea_data": {
            "id": "idea-1",
            "keyword": "Keyword one",
            "content_angle": "comprehensive_guide",
        },
        "generated_content": {},
        "status": "pending",
        "generation_transport": "dynamodb_stream_v1",
        "generation_attempts": 0,
        "created_at": "2026-09-20T10:00:00Z",
        "updated_at": "2026-09-20T10:00:00Z",
    }
    table, rows = stateful_content_table()
    current = {
        **pending,
        "status": current_status,
        "generation_attempts": current_attempts,
    }
    if current_owner is not None:
        current["generation_owner"] = current_owner
    if current_status == "generating":
        current["generation_lease_expires_at"] = current_lease_expires_at or 1
    elif current_lease_expires_at is not None:
        current["generation_lease_expires_at"] = current_lease_expires_at
    rows["content-1"] = current
    return (
        content_studio_resource(content_table=table),
        rows,
        stream_insert_event(pending, event_id=event_id),
    )


@contextmanager
def patched_stream_worker(
    module: Any,
    resource: MagicMock,
    generation: MagicMock,
) -> Iterator[None]:
    """Patch stream worker dependencies while retaining the real claim path."""
    with (
        patch.object(module, "dynamodb", resource),
        patch.object(module, "get_brand_config", return_value={"name": "Test Brand"}),
        patch.object(module, "generate_content", generation),
    ):
        yield


@dataclass(frozen=True)
class StreamWorkerRun:
    """Observable result of one stream worker invocation."""

    response: dict[str, Any]
    resource: MagicMock
    rows: dict[str, dict[str, Any]]
    generation: MagicMock
    event: dict[str, Any]


def run_stream_worker(
    module: Any,
    generation_result: dict[str, Any],
    *,
    event_id: str = "stream-event-1",
    current_status: str = "pending",
    current_owner: str | None = None,
    current_attempts: int = 0,
    current_lease_expires_at: int | None = None,
    event_status: str | None = None,
    event_transport: str | None = "dynamodb_stream_v1",
    generation_side_effect: BaseException | None = None,
) -> StreamWorkerRun:
    """Invoke one stream event with stateful storage and model output."""
    resource, rows, event = stream_worker_case(
        event_id=event_id,
        current_status=current_status,
        current_owner=current_owner,
        current_attempts=current_attempts,
        current_lease_expires_at=current_lease_expires_at,
    )
    new_image = event["Records"][0]["dynamodb"]["NewImage"]
    if event_status is not None:
        new_image["status"] = {"S": event_status}
    if event_transport is None:
        new_image.pop("generation_transport")
    else:
        new_image["generation_transport"] = {"S": event_transport}
    generation = MagicMock(return_value=generation_result)
    if generation_side_effect is not None:
        generation.side_effect = generation_side_effect
    with patched_stream_worker(module, resource, generation):
        response = module.handler(event, None)
    return StreamWorkerRun(response, resource, rows, generation, event)


def active_keyword_rows(count: int) -> list[dict[str, object]]:
    """Return numbered authoritative keyword rows for batch tests."""
    return [active_keyword(f"keyword-{index}", f"Keyword {index:02d}") for index in range(1, count + 1)]


def selected_keyword_scope(count: int) -> dict[str, object]:
    """Return a numbered current keyword scope for batch tests."""
    return {
        "mode": "keywords",
        "keyword_ids": [f"keyword-{index}" for index in range(1, count + 1)],
    }


def batch_manifest_item(
    child_ids: list[str],
    *,
    batch_id: str = "batch-1",
    **overrides: object,
) -> dict[str, object]:
    """Return one durable batch manifest with ordered child descriptors."""
    children = [
        {
            "id": child_id,
            "idea_id": f"idea-{child_id}",
            "keyword_id": f"keyword-{position}",
            "keyword": f"Keyword {child_id}",
            "position": position,
        }
        for position, child_id in enumerate(child_ids, start=1)
    ]
    item: dict[str, object] = {
        "batch_id": batch_id,
        "request_hash": "request-hash",
        "children": children,
        "batch_size": len(children),
        "scope": {
            "mode": "keywords",
            "keyword_ids": [f"keyword-{index}" for index in range(1, len(children) + 1)],
        },
        "created_at": "2026-09-20T10:00:00Z",
        "updated_at": "2026-09-20T10:00:00Z",
    }
    item.update(overrides)
    return item


def batch_status_event(batch_id: str = "batch-1") -> dict[str, Any]:
    """Build the authenticated route event for one batch status read."""
    return api_gateway_event(
        "GET",
        f"/content-studio/batches/{batch_id}",
        path_params={"batch_id": batch_id},
    )


def batch_status_resource(
    manifest: dict[str, object] | None,
    items: list[dict[str, object]] | None = None,
) -> tuple[MagicMock, MagicMock]:
    """Return a resource and manifest table for one batch status response."""
    manifest_response = {"Item": manifest} if manifest is not None else {}
    batch_table = fake_table(get_item=manifest_response)
    resource = content_studio_resource(
        content_table=fake_table(),
        batch_table=batch_table,
    )
    resource.batch_get_item.return_value = {
        "Responses": {CONTENT_STUDIO_TABLE_NAME: items or []},
    }
    return resource, batch_table


def call_batch_status(
    module: Any,
    resource: MagicMock,
    batch_id: str = "batch-1",
) -> tuple[int, Any]:
    """Invoke one batch-status route against the supplied DynamoDB resource."""
    with patch.object(module, "dynamodb", resource):
        response = module._api_handler(batch_status_event(batch_id), None)
    return parse_response(response)


def status_query_pages(
    *,
    pending: list[dict[str, object]] | None = None,
    generating: list[dict[str, object]] | None = None,
    generated: list[dict[str, object]] | None = None,
    failed: list[dict[str, object]] | None = None,
) -> list[dict[str, list[dict[str, object]]]]:
    """Return query pages in the handler's fixed status-query order."""
    return [
        {"Items": pending or []},
        {"Items": generating or []},
        {"Items": generated or []},
        {"Items": failed or []},
    ]


def call_content_template_route(
    module: Any,
    template_table: MagicMock,
    method: str,
    *,
    body: dict[str, object] | None = None,
    template_id: str | None = None,
) -> tuple[int, Any]:
    """Invoke one saved-template route against the supplied table."""
    with patched_content_studio(module, content_template_resource(template_table)):
        response = module._api_handler(
            content_template_event(
                method,
                body=body,
                template_id=template_id,
            ),
            None,
        )
    return parse_response(response)


def queue_content_brief_for_test(
    module: Any,
    idea: dict[str, object],
    *,
    template_table: MagicMock,
    content_table: MagicMock,
) -> tuple[int, Any]:
    """Queue one brief with authoritative keyword and template tables."""
    resource = content_template_resource(
        template_table,
        content_table=content_table,
    )
    with patched_content_studio(module, resource):
        response = module._generate_content(content_generation_event(idea), None)
    return parse_response(response)


def content_template_generation_case(
    saved_item: dict[str, object] | None = None,
    /,
    **idea_overrides: object,
) -> tuple[MagicMock, MagicMock, dict[str, object]]:
    """Return template/content tables and a selected-keyword template request."""
    item = content_brief_template_item() if saved_item is None else saved_item
    template_table = fake_table(get_item={"Item": item})
    content_table = fake_table()
    idea_fields: dict[str, object] = {
        "scope": {"mode": "keywords", "keyword_ids": ["keyword-1"]},
        "template_id": "template-1",
    }
    idea_fields.update(idea_overrides)
    idea = build_scoped_content_brief(**idea_fields)
    return template_table, content_table, idea


def queued_template_snapshot(
    module: Any,
    **idea_overrides: object,
) -> tuple[int, dict[str, Any]]:
    """Queue a default saved-template case and return its persisted snapshot."""
    template_table, content_table, idea = content_template_generation_case(**idea_overrides)
    status, _ = queue_content_brief_for_test(
        module,
        idea,
        template_table=template_table,
        content_table=content_table,
    )
    snapshot = content_table.put_item.call_args.kwargs["Item"]["idea_data"]
    return status, snapshot


def create_content_template_for_test(
    module: Any,
    **overrides: object,
) -> tuple[int, Any, MagicMock]:
    """Submit one template create request and return response plus table spy."""
    table = fake_table(scan={"Count": 0})
    status, body = call_content_template_route(
        module,
        table,
        "POST",
        body=valid_content_template_body(**overrides),
    )
    return status, body, table



def pending_recovery_row(content_id: str) -> dict[str, object]:
    """Return one old versioned pending row eligible for scheduled recovery."""
    return {
        "id": content_id,
        "idea_data": {
            "id": f"idea-{content_id}",
            "keyword": f"Keyword {content_id}",
        },
        "status": "pending",
        "generation_transport": "dynamodb_stream_v1",
        "generation_attempts": 0,
        "created_at": "2020-01-01T00:00:00Z",
        "updated_at": "2020-01-01T00:00:00Z",
    }



@dataclass(frozen=True)
class ReconcileWorkerRun:
    """Observable state from one scheduled reconciliation invocation."""

    response: dict[str, Any]
    table: MagicMock
    rows: dict[str, dict[str, Any]]
    lambda_client: MagicMock


def run_reconcile_worker(
    module: Any,
    candidates: list[dict[str, Any]],
    query_responses: list[dict[str, Any]],
    *,
    invocation_status: int = 202,
) -> ReconcileWorkerRun:
    """Invoke scheduled recovery with stateful rows and a fake Lambda client."""
    table, rows = stateful_content_table()
    rows.update({str(candidate["id"]): candidate for candidate in candidates})
    table.query.side_effect = query_responses
    resource = content_studio_resource(content_table=table)
    lambda_client = MagicMock()
    lambda_client.invoke.return_value = {"StatusCode": invocation_status}
    with (
        patch.object(module, "dynamodb", resource),
        patch.object(module.boto3, "client", return_value=lambda_client),
        patch.object(module.uuid, "uuid4", return_value="recovery-id"),
    ):
        response = module.handler({"action": "reconcile"}, None)
    return ReconcileWorkerRun(response, table, rows, lambda_client)


@dataclass(frozen=True)
class TemplateBatchRepairCase:
    """Shared storage and request for immutable saved-template batch retries."""

    content_table: MagicMock
    rows: dict[str, dict[str, Any]]
    batch_table: MagicMock
    template_table: MagicMock
    request: dict[str, object]


def template_batch_repair_case(
    saved_template: dict[str, object] | None = None,
) -> TemplateBatchRepairCase:
    """Return durable tables and a template-reference batch request."""
    content_table, rows = stateful_content_table()
    batch_table, _ = stateful_batch_table()
    saved = saved_template or content_brief_template_item()
    template_table = fake_table(get_item={"Item": saved})
    brief = build_batch_brief(template_id="template-1")
    brief.pop("prompt_template")
    return TemplateBatchRepairCase(
        content_table,
        rows,
        batch_table,
        template_table,
        build_batch_request(brief=brief),
    )


def call_content_status(
    module: Any,
    row: dict[str, object],
    content_id: str,
) -> tuple[int, Any]:
    """Invoke one content status route against an exact stored row."""
    table = fake_table(get_item={"Item": row})
    event = api_gateway_event(
        "GET",
        f"/content-studio/status/{content_id}",
        path_params={"id": content_id},
    )
    with patch.object(module, "dynamodb", content_studio_resource(content_table=table)):
        return parse_response(module._api_handler(event, None))
