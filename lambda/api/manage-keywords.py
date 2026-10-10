"""
Manage Keywords API Lambda

Handles POST, PUT, DELETE operations for keywords.

Create and update take two optional references: ``market_id`` (a configured
market; ``''``/``null``/``'global'`` = the global market, an unknown id is a
400) and ``concept_id`` (the id of the keyword this one localizes; every
translation of one question shares the source keyword's id). On update an
omitted reference is left alone and ``''``/``null`` removes it.
"""

import sys
from typing import Any

import boto3
from botocore.exceptions import ClientError

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import api_response, success_response, validation_error
from shared.decorators import api_handler, parse_json_body, route_handler, validate
from shared.dynamodb_conditions import delete_existing_item, is_conditional_check_failure
from shared.env_vars import resolve_table_env
from shared.keyword_groups import (
    MAX_GROUPS_PER_KEYWORD,
    open_keyword_tables,
    serialize_keyword_item,
)
from shared.keyword_store import (
    ALLOWED_KEYWORD_PRIORITIES,
    ALLOWED_KEYWORD_STATUSES,
    KeywordReference,
    build_keyword_item,
    keyword_reference,
    put_keyword_if_absent,
    resolve_concept_id,
    validate_keyword_market,
    validate_keyword_text,
)
from shared.requested_group_ids import validate_requested_group_ids
from shared.utils import get_timestamp, keyword_id, load_keyword_identities, normalize_keyword

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables (audit #12 canonical naming).
keywords_table, groups_table = open_keyword_tables(dynamodb)
# The market list (BrandConfig item `markets`), read only when a request names a market.
BRAND_CONFIG_TABLE = resolve_table_env('DYNAMODB_TABLE_BRAND_CONFIG', required=False, default='CitationAnalysis-BrandConfig')
brand_config_table = dynamodb.Table(BRAND_CONFIG_TABLE)

# The optional metadata fields an update may carry, each with the attribute it
# is written to -- a ``#`` name placeholder for ``region`` and ``language``,
# which are DynamoDB reserved words -- and its value placeholder.
_OPTIONAL_UPDATE_FIELDS = (
    ('region', '#r', ':r'),
    ('language', '#l', ':l'),
    ('category', 'category', ':c'),
    ('priority', 'priority', ':p'),
    ('notes', 'notes', ':n'),
)


def _validated_request(keyword, body, event):
    """Validate the keyword text and the optional ``group_ids`` of a create/update body.

    The keyword is trimmed without runtime-specific strip: the shared sequence
    (type → surrogate check → trim → length) lives in ``shared.keyword_store``,
    and empty-after-trim rejects on this route (bugs.md 3.3). ``group_ids`` is
    ``None`` when the field was omitted; every listed id must exist.

    Returns ``(text, group_ids, None)`` or ``(None, None, error_response)``.
    """
    text, message = validate_keyword_text(keyword)
    if message:
        return None, None, validation_error(message, event, 'keyword')
    group_ids, message = validate_requested_group_ids(body, groups_table, limit=MAX_GROUPS_PER_KEYWORD)
    if message:
        return None, None, validation_error(message, event, 'group_ids')
    return text, group_ids, None


def _duplicate_response(event):
    """Return the stable conflict response for an occupied keyword identity."""
    return api_response(409, {'error': 'Keyword already exists'}, event)


def _resolved_reference(body, field, resolve):
    """The ``field`` reference of ``body`` with its value resolved by ``resolve``; ``(reference, error)``."""
    reference, error = keyword_reference(body, field)
    if reference is None:
        return None, error
    if not reference.given:
        return reference, None
    value, error = resolve(reference.value)
    if error:
        return None, error
    return KeywordReference(given=True, value=value), None


def _validated_references(body, event, own_id):
    """The ``market_id`` and ``concept_id`` of a create/update body, checked against the tables.

    Returns ``({'market_id': ref, 'concept_id': ref}, None)`` or ``(None, error_response)``.
    """
    resolvers = {
        'market_id': lambda value: validate_keyword_market(value, brand_config_table),
        'concept_id': lambda value: resolve_concept_id(keywords_table, value, own_id),
    }
    references = {}
    for field, resolve in resolvers.items():
        reference, message = _resolved_reference(body, field, resolve)
        if reference is None:
            return None, validation_error(str(message), event, field)
        references[field] = reference
    return references, None


def _update_request(
    text: str,
    status: str | None,
    stored_keyword: str,
    metadata: dict[str, Any],
    group_ids: list[str] | None,
    references: dict[str, KeywordReference],
) -> tuple[str, dict[str, str], dict[str, Any]]:
    """The ``UpdateExpression`` and its attribute names and values for one keyword update.

    ``metadata`` holds the request value of every field in
    ``_OPTIONAL_UPDATE_FIELDS``; ``None`` leaves that attribute untouched.
    ``group_ids`` is a string set, and DynamoDB cannot store an empty set, so
    an empty list clears the attribute instead; ``None`` leaves memberships
    alone. ``references`` (``market_id``, ``concept_id``) are set, removed
    (given as ``''``/``null``) or left alone (omitted).
    """
    update_expr = 'SET #kw = :k, updated_at = :u'
    expr_names = {'#id': 'id', '#kw': 'keyword'}
    expr_values: dict[str, Any] = {
        ':expected_keyword': stored_keyword,
        ':k': text,
        ':u': get_timestamp(),
    }
    removed: list[str] = []

    # Omitted means "leave the status alone", like every other optional field
    # below. `status` used to default to 'active' and be written on every
    # update, so renaming a paused keyword silently activated it — and an
    # activated keyword is queried against every provider on the next run, so
    # the edit quietly added spend. Research promotes unselected proposals as
    # inactive, which is exactly the population a rename would resurrect.
    if status is not None:
        update_expr += ', #s = :st'
        expr_names['#s'] = 'status'
        expr_values[':st'] = status

    for field, attribute, placeholder in _OPTIONAL_UPDATE_FIELDS:
        value = metadata[field]
        if value is None:
            continue
        update_expr += f', {attribute} = {placeholder}'
        if attribute.startswith('#'):
            expr_names[attribute] = field
        expr_values[placeholder] = value

    for field, reference in references.items():
        if reference.value is not None:
            update_expr += f', {field} = :{field}'
            expr_values[f':{field}'] = reference.value
        elif reference.given:
            removed.append(field)

    if group_ids:
        update_expr += ', group_ids = :g'
        expr_values[':g'] = set(group_ids)
    elif group_ids is not None:
        removed.append('group_ids')

    if removed:
        update_expr += f" REMOVE {', '.join(removed)}"
    return update_expr, expr_names, expr_values


@parse_json_body
@validate({
    'keyword': {'required': True, 'source': 'body'},
    'region': {'type': str, 'max_length': 50, 'default': 'global', 'source': 'body'},
    'language': {'type': str, 'max_length': 10, 'default': 'en', 'source': 'body'},
    'category': {'type': str, 'max_length': 100, 'default': '', 'source': 'body'},
    'priority': {'choices': list(ALLOWED_KEYWORD_PRIORITIES), 'default': 'normal', 'source': 'body'},
    'notes': {'type': str, 'max_length': 1000, 'default': '', 'source': 'body'}
})
def create_keyword(event, context, body, keyword, region, language, category, priority, notes):
    """Create a keyword under its canonical deterministic identity."""
    text, group_ids, error = _validated_request(keyword, body, event)
    if text is None:
        return error

    identity = normalize_keyword(text)
    if identity in load_keyword_identities(keywords_table):
        return _duplicate_response(event)
    references, error = _validated_references(body, event, keyword_id(text))
    if references is None:
        return error

    item = build_keyword_item(
        text,
        timestamp=get_timestamp(),
        region=region,
        language=language,
        category=category,
        priority=priority,
        notes=notes,
        market_id=references['market_id'].value,
        concept_id=references['concept_id'].value,
    )
    if group_ids:
        item['group_ids'] = set(group_ids)
    if not put_keyword_if_absent(keywords_table, item):
        return _duplicate_response(event)

    return success_response(serialize_keyword_item(item), event, 201)


@parse_json_body
@validate({
    'keyword': {'required': True, 'source': 'body'},
    # No default: absent must mean "unchanged", not "active". See `_update_request`.
    'status': {'choices': list(ALLOWED_KEYWORD_STATUSES), 'source': 'body'},
    'region': {'type': str, 'max_length': 50, 'source': 'body'},
    'language': {'type': str, 'max_length': 10, 'source': 'body'},
    'category': {'type': str, 'max_length': 100, 'source': 'body'},
    'priority': {'choices': list(ALLOWED_KEYWORD_PRIORITIES), 'source': 'body'},
    'notes': {'type': str, 'max_length': 1000, 'source': 'body'}
})
def update_keyword(event, context, body, keyword, status, region, language, category, priority, notes, id=None):
    """Update display text and metadata without changing canonical identity."""
    if not id:
        return validation_error('Keyword ID is required', event, 'id')

    text, group_ids, error = _validated_request(keyword, body, event)
    if text is None:
        return error

    existing = keywords_table.get_item(
        Key={'id': id},
        ConsistentRead=True,
    ).get('Item')
    if not existing:
        return api_response(404, {'error': 'Keyword not found'}, event)

    stored_keyword = existing.get('keyword')
    if not isinstance(stored_keyword, str) or normalize_keyword(stored_keyword) != normalize_keyword(text):
        return api_response(
            409,
            {'error': 'Keyword identity cannot be changed; delete it and create a new keyword instead'},
            event,
        )
    references, error = _validated_references(body, event, id)
    if references is None:
        return error

    update_expr, expr_names, expr_values = _update_request(
        text,
        status,
        stored_keyword,
        {'region': region, 'language': language, 'category': category, 'priority': priority, 'notes': notes},
        group_ids,
        references,
    )
    try:
        response = keywords_table.update_item(
            Key={'id': id},
            UpdateExpression=update_expr,
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_values,
            ConditionExpression='attribute_exists(#id) AND #kw = :expected_keyword',
            ReturnValues='ALL_NEW'
        )
    except ClientError as write_error:
        if not is_conditional_check_failure(write_error):
            raise
        return api_response(
            409,
            {'error': 'Keyword changed while it was being updated'},
            event,
        )

    return success_response(serialize_keyword_item(response['Attributes']), event)


def delete_keyword(event, context, id=None):
    """Delete a keyword only when its row still exists."""
    if not id:
        return validation_error('Keyword ID is required', event, 'id')

    if not delete_existing_item(keywords_table, id):
        return api_response(404, {'error': 'Keyword not found'}, event)

    return success_response({'message': 'Keyword deleted successfully'}, event)


@api_handler
@route_handler({
    'POST': create_keyword,
    'PUT': update_keyword,
    'DELETE': delete_keyword,
}, inject_path_params=True)
def handler(event, context):
    """
    POST /api/keywords - Create new keyword
    PUT /api/keywords/{id} - Update keyword
    DELETE /api/keywords/{id} - Delete keyword

    The ``{id}`` path parameter reaches update/delete as the ``id`` kwarg via
    ``inject_path_params`` — the hand-rolled routing this file used to carry
    (bugs.md 3.4) is gone.
    """
