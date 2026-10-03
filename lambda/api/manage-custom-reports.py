"""
Custom Reports API Lambda

Saved layouts from the Reports custom report builder. Reports are shared by
every signed-in user of the deployment, like keyword groups and Content Studio
templates: any Cognito-authenticated caller may list, save, edit and delete
them, so there is no ``@require_group`` gate and no owner check.

Routes (all under the consolidated ConfigMgmt function):
    GET    /api/custom-reports        every saved report, most recently edited first
    POST   /api/custom-reports        save a new report (at most MAX_CUSTOM_REPORTS)
    PUT    /api/custom-reports/{id}   replace a report's title, blocks and days
    DELETE /api/custom-reports/{id}   delete a report

A report is a title, a reporting window (``days``) and an ordered list of
blocks. Data blocks (charts and tables the dashboard computes from live data)
carry nothing but their ``type`` and are stored as given, so a dashboard
release can add block types without a backend change; the dashboard skips
types it does not know. Content blocks (``heading``, ``text``, ``image``,
``video``) carry what the author typed and are validated here field by field.
Image and video links must be https; a video must be a YouTube or Vimeo link
the dashboard can embed, because the CloudFront CSP ``frame-src`` admits only
the privacy-enhanced YouTube player and the Vimeo player. The link rules are
pinned for both runtimes by ``test-fixtures/custom-report-blocks.json``.
"""

import logging
import re
import sys
import unicodedata
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from functools import wraps
from typing import Any
from urllib.parse import SplitResult, parse_qsl, urlsplit

import boto3
from botocore.exceptions import ClientError

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import api_response, not_found_response, success_response, validation_error
from shared.auth import get_caller_claims, get_caller_identity
from shared.decorators import api_handler, parse_json_body, route_handler, validate
from shared.dynamo_conditions import delete_existing_item, is_conditional_check_failure
from shared.dynamo_decimal import to_int
from shared.dynamodb_batch import collect_all_items
from shared.env_vars import resolve_table_env
from shared.utils import get_timestamp

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')
reports_table = dynamodb.Table(resolve_table_env('DYNAMODB_TABLE_CUSTOM_REPORTS'))

# The whole table is read on every list and before every create, which stays
# one small scan only while the count is bounded.
MAX_CUSTOM_REPORTS = 50
MAX_TITLE_LENGTH = 80
REPORT_DAYS = (30, 90, 180)
DEFAULT_REPORT_DAYS = 90
MAX_BLOCKS = 30
# Generated ids are 36-character UUIDs; anything much longer cannot be one.
MAX_REPORT_ID_LENGTH = 64
MAX_URL_LENGTH = 2048

_BLOCK_TYPE = re.compile(r'[a-z][a-z0-9_]{1,47}')
_YOUTUBE_ID = r'[A-Za-z0-9_-]{11}'
_VIMEO_ID = r'[0-9]{1,12}'
_YOUTUBE_WATCH_ID = re.compile(_YOUTUBE_ID)
_YOUTUBE_HOSTS = ('youtube.com', 'www.youtube.com', 'm.youtube.com')
_YOUTUBE_PLAYER_PATH = re.compile(rf'/(?:embed|shorts)/{_YOUTUBE_ID}')
_NOCOOKIE_PLAYER_PATH = re.compile(rf'/embed/{_YOUTUBE_ID}')
_VIMEO_PAGE_PATH = re.compile(rf'/{_VIMEO_ID}')
# Every other video link is one of these exact host/path shapes; host names
# are compared lowercased (``SplitResult.hostname`` lowercases them).
_VIDEO_PATHS: dict[str, re.Pattern[str]] = {
    **dict.fromkeys(_YOUTUBE_HOSTS, _YOUTUBE_PLAYER_PATH),
    'youtu.be': re.compile(rf'/{_YOUTUBE_ID}'),
    'youtube-nocookie.com': _NOCOOKIE_PLAYER_PATH,
    'www.youtube-nocookie.com': _NOCOOKIE_PLAYER_PATH,
    'vimeo.com': _VIMEO_PAGE_PATH,
    'www.vimeo.com': _VIMEO_PAGE_PATH,
    'player.vimeo.com': re.compile(rf'/video/{_VIMEO_ID}'),
}

_DAYS_ERROR = f"Invalid days. Must be one of: {', '.join(str(days) for days in REPORT_DAYS)}"
_REPORT_SCHEMA: dict[str, dict[str, Any]] = {
    'title': {
        'required': True,
        'type': str,
        'min_length': 1,
        'max_length': MAX_TITLE_LENGTH,
        'source': 'body',
    },
    'days': {'type': int, 'choices': list(REPORT_DAYS), 'default': DEFAULT_REPORT_DAYS, 'source': 'body'},
}

_Route = Callable[..., dict[str, Any]]
# Marks an optional block field the author left out or left blank.
_OMITTED = object()


class _InvalidField(ValueError):
    """A block field value the API refuses; the message is the problem, e.g. ``must be a string``."""


class _InvalidBlocks(ValueError):
    """A ``blocks`` value the API refuses; the message is the whole sentence the caller sees."""


@dataclass(frozen=True)
class _BlockField:
    """One key a content block carries and how its value is cleaned for storage."""

    name: str
    clean: Callable[[Any], Any]
    required: bool = True


@dataclass(frozen=True)
class _ReportContent:
    """The validated, stored-as-is parts of a report request."""

    title: str
    blocks: list[dict[str, Any]]
    days: int


# --- block fields -------------------------------------------------------------


def _stripped_string(value: Any) -> str:
    if not isinstance(value, str):
        raise _InvalidField('must be a string')
    return value.strip()


def _bounded_text(max_length: int) -> Callable[[Any], str]:
    """A cleaner for a stripped string of 1 to ``max_length`` characters."""
    def clean(value: Any) -> str:
        text = _stripped_string(value)
        if not text:
            raise _InvalidField('is required')
        if len(text) > max_length:
            raise _InvalidField(f'must be at most {max_length} characters')
        return text
    return clean


def _heading_level(value: Any) -> int:
    # `type(...) is int` refuses booleans and integral floats such as 2.0.
    if type(value) is not int or value not in (2, 3):
        raise _InvalidField('must be 2 or 3')
    return value


_url_text = _bounded_text(MAX_URL_LENGTH)


def _is_blank_or_control(character: str) -> bool:
    return character.isspace() or unicodedata.category(character) == 'Cc'


def _authority_is_plain(parts: SplitResult) -> bool:
    """A host and at most a usable port: no user name, no password, no malformed port."""
    try:
        port = parts.port
    except ValueError:
        return False
    return parts.username is None and parts.password is None and port != 0


def _https_link(value: Any) -> tuple[str, SplitResult]:
    """The stripped link and its parts, when ``value`` is an https link the dashboard may load."""
    text = _url_text(value)
    # Browsers read a backslash as a slash, so the link would not load what it says.
    if '\\' in text or any(_is_blank_or_control(character) for character in text):
        raise _InvalidField('must be an https link')
    try:
        parts = urlsplit(text)
    except ValueError as exc:
        raise _InvalidField('must be an https link') from exc
    if parts.scheme != 'https' or not parts.hostname or not _authority_is_plain(parts):
        raise _InvalidField('must be an https link')
    return text, parts


def _image_url(value: Any) -> str:
    text, _parts = _https_link(value)
    return text


def _first_query_value(query: str, name: str) -> str:
    return next((value for key, value in parse_qsl(query) if key == name), '')


def _is_embeddable_video(parts: SplitResult) -> bool:
    """True for the YouTube and Vimeo link shapes the dashboard turns into a player URL."""
    host = parts.hostname or ''
    if parts.netloc.lower() != host:
        # An explicit port, even an empty one (`youtu.be:/...`).
        return False
    if host in _YOUTUBE_HOSTS and parts.path == '/watch':
        return _YOUTUBE_WATCH_ID.fullmatch(_first_query_value(parts.query, 'v')) is not None
    path = _VIDEO_PATHS.get(host)
    return path is not None and path.fullmatch(parts.path) is not None


def _video_url(value: Any) -> str:
    text, parts = _https_link(value)
    if not _is_embeddable_video(parts):
        raise _InvalidField('must be a YouTube or Vimeo video link')
    return text


_CAPTION = _BlockField('caption', _bounded_text(200), required=False)
# Content blocks take exactly these keys besides `type`; every other type is a
# data block and takes `type` alone.
_CONTENT_BLOCK_FIELDS: dict[str, tuple[_BlockField, ...]] = {
    'heading': (_BlockField('text', _bounded_text(120)), _BlockField('level', _heading_level)),
    'text': (_BlockField('markdown', _bounded_text(5000)),),
    'image': (_BlockField('url', _image_url), _BlockField('alt', _bounded_text(200)), _CAPTION),
    'video': (_BlockField('url', _video_url), _CAPTION),
}


# --- blocks ---------------------------------------------------------------------


def _field_value(block: dict[str, Any], field: _BlockField) -> Any:
    """The cleaned value of ``field`` in ``block``, or ``_OMITTED`` for a blank optional field."""
    if field.name not in block:
        if field.required:
            raise _InvalidField('is required')
        return _OMITTED
    value = block[field.name]
    if not field.required and isinstance(value, str) and not value.strip():
        return _OMITTED
    return field.clean(value)


def _block_type(position: int, block: Any) -> str:
    if not isinstance(block, dict):
        raise _InvalidBlocks(f'Block {position}: must be an object')
    block_type = block.get('type')
    if not isinstance(block_type, str) or not _BLOCK_TYPE.fullmatch(block_type):
        raise _InvalidBlocks(
            f'Block {position}: type must be 2-48 lowercase letters, digits or underscores, starting with a letter'
        )
    return block_type


def _clean_block(position: int, block: Any) -> dict[str, Any]:
    """The block as stored: ``type`` plus its content fields, stripped; raises ``_InvalidBlocks``."""
    block_type = _block_type(position, block)
    fields = _CONTENT_BLOCK_FIELDS.get(block_type, ())
    unexpected = sorted(block.keys() - {'type', *(field.name for field in fields)})
    if unexpected:
        raise _InvalidBlocks(f'Block {position}: {block_type} does not accept {unexpected[0]}')

    cleaned: dict[str, Any] = {'type': block_type}
    for field in fields:
        try:
            value = _field_value(block, field)
        except _InvalidField as exc:
            raise _InvalidBlocks(f'Block {position}: {block_type} {field.name} {exc}') from exc
        if value is not _OMITTED:
            cleaned[field.name] = value
    return cleaned


def _clean_blocks(blocks: Any) -> list[dict[str, Any]]:
    if blocks is None:
        raise _InvalidBlocks('Missing required field: blocks')
    if not isinstance(blocks, list):
        raise _InvalidBlocks('blocks must be a list')
    if not blocks:
        raise _InvalidBlocks('blocks must contain at least 1 block')
    if len(blocks) > MAX_BLOCKS:
        raise _InvalidBlocks(f'blocks must contain at most {MAX_BLOCKS} blocks')
    return [_clean_block(position, block) for position, block in enumerate(blocks, start=1)]


# --- request plumbing -----------------------------------------------------------


def _strict_type_error(event: dict[str, Any], body: dict[str, Any]) -> dict[str, Any] | None:
    """The 400 for a title or days that ``@validate`` would coerce (``123`` to ``"123"``, ``"90"`` to ``90``)."""
    if not isinstance(body.get('title'), str):
        return validation_error('title must be a string', event, 'title')
    days = body.get('days')
    # `type(...) is int` refuses booleans and integral floats such as 90.0.
    if days is not None and type(days) is not int:
        return validation_error(_DAYS_ERROR, event, 'days')
    return None


def _json_object_body(route: _Route) -> _Route:
    """Answer 400 before ``@validate`` reads fields from a body that is not a JSON object."""
    @wraps(route)
    def wrapper(event: dict[str, Any], context: Any, *args: Any, body: Any, **kwargs: Any) -> dict[str, Any]:
        if not isinstance(body, dict):
            return validation_error('Request body must be a JSON object', event, 'body')
        return route(event, context, *args, body=body, **kwargs)
    return wrapper


def _report_request(route: _Route) -> _Route:
    """Answer 400 unless the body is a valid report; otherwise call ``route`` with ``content=``."""
    @parse_json_body
    @_json_object_body
    @validate(_REPORT_SCHEMA)
    @wraps(route)
    def wrapper(
        event: dict[str, Any], context: Any, *args: Any, body: dict[str, Any], title: str, days: int, **kwargs: Any,
    ) -> dict[str, Any]:
        type_error = _strict_type_error(event, body)
        if type_error is not None:
            return type_error
        try:
            blocks = _clean_blocks(body.get('blocks'))
        except _InvalidBlocks as exc:
            return validation_error(str(exc), event, 'blocks')
        return route(event, context, *args, content=_ReportContent(title, blocks, days), **kwargs)
    return wrapper


def _report_not_found(event: dict[str, Any]) -> dict[str, Any]:
    return not_found_response(resource='Custom report', event=event)


def _for_report_id(route: _Route) -> _Route:
    """Answer 404 without touching DynamoDB unless ``{id}`` could name a stored report."""
    @wraps(route)
    def wrapper(event: dict[str, Any], context: Any, *args: Any, **kwargs: Any) -> dict[str, Any]:
        report_id = kwargs.get('id')
        if not isinstance(report_id, str) or not report_id or len(report_id) > MAX_REPORT_ID_LENGTH:
            return _report_not_found(event)
        return route(event, context, *args, **kwargs)
    return wrapper


def _caller(event: dict[str, Any]) -> str:
    """The signed-in user to record as author or editor: the email claim, else the Cognito identity."""
    email = get_caller_claims(event).get('email')
    if isinstance(email, str) and email.strip():
        return email.strip()
    return get_caller_identity(event) or ''


def _block_view(block: dict[str, Any]) -> dict[str, Any]:
    # DynamoDB hands numbers back as Decimal; the only stored number is a heading level.
    return {key: to_int(value) if isinstance(value, Decimal) else value for key, value in block.items()}


def _report_view(item: dict[str, Any]) -> dict[str, Any]:
    """The public report shape, whatever else the row holds."""
    return {
        'id': item['id'],
        'title': item.get('title', ''),
        'blocks': [_block_view(block) for block in item.get('blocks') or [] if isinstance(block, dict)],
        'days': to_int(item.get('days'), DEFAULT_REPORT_DAYS),
        'created_at': item.get('created_at', ''),
        'created_by': item.get('created_by', ''),
        'updated_at': item.get('updated_at', ''),
        'updated_by': item.get('updated_by', ''),
    }


# --- routes ---------------------------------------------------------------------


def list_reports(event: dict[str, Any], context: Any, **_: Any) -> dict[str, Any]:
    """GET /api/custom-reports"""
    reports = [_report_view(item) for item in collect_all_items(reports_table.scan) if item.get('id')]
    # Two stable sorts: newest edit first, ties in id order.
    reports.sort(key=lambda report: report['id'])
    reports.sort(key=lambda report: report['updated_at'], reverse=True)
    return success_response({'reports': reports}, event)


@_report_request
def create_report(event: dict[str, Any], context: Any, content: _ReportContent, **_: Any) -> dict[str, Any]:
    """POST /api/custom-reports"""
    stored = collect_all_items(reports_table.scan, ProjectionExpression='#id', ExpressionAttributeNames={'#id': 'id'})
    if len(stored) >= MAX_CUSTOM_REPORTS:
        return api_response(409, {'error': 'limit_reached', 'field': 'reports'}, event)

    timestamp = get_timestamp()
    caller = _caller(event)
    item = {
        'id': str(uuid.uuid4()),
        'title': content.title,
        'blocks': content.blocks,
        'days': content.days,
        'created_at': timestamp,
        'created_by': caller,
        'updated_at': timestamp,
        'updated_by': caller,
    }
    reports_table.put_item(Item=item)
    return success_response({'report': _report_view(item)}, event, 201)


@_for_report_id
@_report_request
def update_report(event: dict[str, Any], context: Any, content: _ReportContent, id: str, **_: Any) -> dict[str, Any]:
    """PUT /api/custom-reports/{id} — replaces title, blocks and days; keeps created_at/created_by."""
    changes = {
        'title': content.title,
        'blocks': content.blocks,
        'days': content.days,
        'updated_at': get_timestamp(),
        'updated_by': _caller(event),
    }
    try:
        response = reports_table.update_item(
            Key={'id': id},
            UpdateExpression='SET ' + ', '.join(f'#{name} = :{name}' for name in changes),
            ConditionExpression='attribute_exists(#id)',
            ExpressionAttributeNames={'#id': 'id', **{f'#{name}': name for name in changes}},
            ExpressionAttributeValues={f':{name}': value for name, value in changes.items()},
            ReturnValues='ALL_NEW',
        )
    except ClientError as error:
        if not is_conditional_check_failure(error):
            raise
        return _report_not_found(event)
    return success_response({'report': _report_view(response['Attributes'])}, event)


@_for_report_id
def delete_report(event: dict[str, Any], context: Any, id: str, **_: Any) -> dict[str, Any]:
    """DELETE /api/custom-reports/{id}"""
    if not delete_existing_item(reports_table, id):
        return _report_not_found(event)
    return success_response({'deleted': id}, event)


@api_handler
@route_handler({
    'GET': list_reports,
    'POST': create_report,
    'PUT': update_report,
    'DELETE': delete_report,
}, inject_path_params=True)
def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Routed entirely by ``route_handler``; see module docstring. This body is never reached."""
    ...
