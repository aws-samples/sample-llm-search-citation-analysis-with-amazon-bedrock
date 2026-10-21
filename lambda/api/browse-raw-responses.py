"""
Browse Raw Responses API Lambda

Provides S3 bucket browsing capabilities for raw API responses and screenshots.
Supports listing folders/files and fetching file content.

Endpoints:
    GET /api/raw-responses/browse?prefix=path/to/folder&bucket=responses|screenshots[&next_token=...]
    GET /api/raw-responses/file?key=path/to/file.json&bucket=responses|screenshots
    GET /api/raw-responses/download?key=path/to/file.json&bucket=responses|screenshots
"""

import functools
import json
import os
import sys
from collections.abc import Callable, Mapping
from typing import Any
from urllib.parse import unquote

import boto3

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import success_response, validation_error
from shared.cursors import CURSOR_ERROR_MESSAGE, CURSOR_QUERY_PARAM, decode_cursor, encode_cursor
from shared.decorators import api_handler, route_handler, validate

s3_client = boto3.client('s3')

# Entries (folders + files) per browse page: S3's own ListObjectsV2 maximum.
BROWSE_PAGE_KEYS = 1000
# Above this object size, /file answers with a presigned download link instead
# of the content: JSON-escaping (and the envelope's second escaping) can more
# than triple accented text on the way out.
MAX_INLINE_FILE_BYTES = 1_000_000

# Fail-fast: Required environment variables.
#
# SCREENSHOTS_BUCKET used to default to '', which made its fallback dead code:
# `BUCKET_MAP.get('screenshots', RAW_RESPONSES_BUCKET)` finds the key and
# returns '' rather than falling back, so a misconfigured deployment answered
# `400 Invalid bucket type: screenshots` on every screenshot request instead of
# failing loudly at cold start. The CDK stack always sets it, so requiring it
# here matches the real contract (audit corrections table).
RAW_RESPONSES_BUCKET = os.environ['RAW_RESPONSES_BUCKET']
SCREENSHOTS_BUCKET = os.environ['SCREENSHOTS_BUCKET']

# Bucket mapping
BUCKET_MAP = {
    'responses': RAW_RESPONSES_BUCKET,
    'screenshots': SCREENSHOTS_BUCKET,
}

# Root prefix for each bucket type
ROOT_PREFIX_MAP = {
    'responses': 'raw-responses/',
    'screenshots': 'screenshots/',
}


def get_bucket_and_prefix(bucket_type: str) -> tuple[str, str]:
    """Get the actual bucket name and root prefix for a bucket type."""
    bucket = BUCKET_MAP.get(bucket_type, RAW_RESPONSES_BUCKET)
    root_prefix = ROOT_PREFIX_MAP.get(bucket_type, 'raw-responses/')
    return bucket, root_prefix


def validate_s3_path(path: str) -> str | None:
    """
    Validate S3 path to prevent path traversal attacks.
    Returns error message if invalid, None if valid.
    """
    if not path:
        return None

    # Check for path traversal attempts
    if '..' in path:
        return 'Path traversal not allowed'

    # Check for absolute paths
    if path.startswith('/'):
        return 'Absolute paths not allowed'

    # Check for null bytes (can be used to bypass validation)
    if '\x00' in path:
        return 'Invalid characters in path'

    # Check for backslashes (Windows-style paths)
    if '\\' in path:
        return 'Invalid path separator'

    return None


def scope_key_to_root(key: str, root_prefix: str) -> tuple[str | None, str | None]:
    """
    Return ``(scoped_key, error)`` for an object key confined to ``root_prefix``.

    `_get_file` and `_get_download` used to resolve the bucket and then discard
    the prefix, so a plain relative key addressed *any* object in either bucket
    and the download route minted a credential-free 15-minute presigned URL for
    it — redeemable by someone with no Cognito account at all
    (AUDIT-2026-08-19 §2.7).

    Idempotent, mirroring `list_prefixes` below: the explorer sends absolute
    keys (from the listing, which returns full keys) but relative prefixes, so
    an already-scoped key must pass through unchanged rather than becoming
    ``raw-responses/raw-responses/...``.

    The `startswith` assertion on the result is a sound containment gate because
    `validate_s3_path` has already rejected ``..``, absolute paths, NUL bytes
    and backslashes — so nothing can climb back out of the prefix.

    Args:
        key: The caller-supplied object key, already unquoted and validated.
        root_prefix: The configured root for this bucket type.

    Returns:
        ``(scoped_key, None)`` on success, ``(None, message)`` on refusal.
    """
    if not key:
        return None, 'key is required'

    scoped = key if key.startswith(root_prefix) else root_prefix + key

    if not scoped.startswith(root_prefix):
        return None, f'key must be within {root_prefix}'

    return scoped, None


def _list_objects(bucket: str, prefix: str, continuation_token: str | None = None) -> Mapping[str, Any]:
    """One ``ListObjectsV2`` page (up to ``BROWSE_PAGE_KEYS`` entries) under ``prefix`` with ``/`` as the delimiter.

    The listing is handed on as an untyped mapping: boto3-stubs marks every
    field of a listed object optional, while S3 always returns ``Key``,
    ``Size`` and ``LastModified`` for objects and ``Prefix`` for common
    prefixes, so the caller reads them without per-field narrowing.
    """
    params: dict[str, Any] = {'Bucket': bucket, 'Prefix': prefix, 'Delimiter': '/', 'MaxKeys': BROWSE_PAGE_KEYS}
    if continuation_token:
        params['ContinuationToken'] = continuation_token
    return s3_client.list_objects_v2(**params)


def resolve_prefix(prefix: str, root_prefix: str) -> str:
    """The listed prefix: under ``root_prefix``, ending in ``/`` (the root itself when empty)."""
    if prefix and not prefix.endswith('/'):
        prefix = prefix + '/'
    if not prefix:
        return root_prefix
    return prefix if prefix.startswith(root_prefix) else root_prefix + prefix


def _folder_entry(common_prefix: Mapping[str, Any]) -> dict[str, Any]:
    folder_path = common_prefix['Prefix']
    return {'name': folder_path.rstrip('/').split('/')[-1], 'path': folder_path, 'type': 'folder'}


def _file_entry(obj: Mapping[str, Any], prefix: str) -> dict[str, Any] | None:
    key = obj['Key']
    file_name = key.split('/')[-1]
    if key == prefix or not file_name:
        return None
    is_image = file_name.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp'))
    return {
        'name': file_name,
        'path': key,
        'type': 'image' if is_image else 'file',
        'size': obj['Size'],
        'last_modified': obj['LastModified'].isoformat(),
    }


def list_prefixes(
    bucket: str,
    prefix: str = '',
    root_prefix: str = 'raw-responses/',
    continuation_token: str | None = None,
) -> dict[str, Any]:
    """
    One page of the folders and files at a given S3 prefix.

    S3 lists keys in ascending order, ``BROWSE_PAGE_KEYS`` entries per page;
    each page is sorted newest first by name and ``next_token`` carries S3's
    continuation token (``None`` on the last page).
    """
    prefix = resolve_prefix(prefix, root_prefix)
    response = _list_objects(bucket, prefix, continuation_token)

    folders = [_folder_entry(cp) for cp in response.get('CommonPrefixes', [])]
    files = [entry for obj in response.get('Contents', []) if (entry := _file_entry(obj, prefix)) is not None]

    # Sort folders and files by name (newest first for date folders and timestamps)
    folders.sort(key=lambda x: x['name'], reverse=True)
    files.sort(key=lambda x: x['name'], reverse=True)

    following = response.get('NextContinuationToken') if response.get('IsTruncated') else None
    return {
        'prefix': prefix,
        'folders': folders,
        'files': files,
        'total_folders': len(folders),
        'total_files': len(files),
        'next_token': encode_cursor({'prefix': prefix, 's3': following}) if following else None,
    }


def decode_browse_token(token: str | None, prefix: str) -> tuple[bool, str | None]:
    """``(valid, s3_continuation_token)`` for a browse ``next_token`` issued for ``prefix``."""
    if token is None:
        return True, None
    decoded = decode_cursor(token, ('prefix', 's3'))
    if decoded is None or decoded['prefix'] != prefix or not isinstance(decoded['s3'], str) or not decoded['s3']:
        return False, None
    return True, decoded['s3']


class ObjectNotFoundError(Exception):
    """A requested S3 object does not exist."""


def get_file_content(bucket: str, key: str) -> dict[str, Any]:
    """
    Get the content of a specific S3 file.

    Objects over ``MAX_INLINE_FILE_BYTES`` are not read: the answer carries
    ``too_large: true`` and a presigned ``download_url`` instead of the content
    (raw provider JSON can pass 1 MB, and JSON-escaped Spanish triples it).
    """
    try:
        response = s3_client.get_object(Bucket=bucket, Key=key)
    except s3_client.exceptions.NoSuchKey as err:
        raise ObjectNotFoundError(f"File not found: {key}") from err

    size = response['ContentLength']
    if size > MAX_INLINE_FILE_BYTES:
        response['Body'].close()
        return {
            'key': key,
            'content': None,
            'content_type': response.get('ContentType', 'application/octet-stream'),
            'size': size,
            'last_modified': response['LastModified'].isoformat(),
            'is_json': False,
            'too_large': True,
            'max_inline_bytes': MAX_INLINE_FILE_BYTES,
            'download_url': generate_download_url(bucket, key),
        }

    content = response['Body'].read().decode('utf-8')

    # Try to parse as JSON for pretty display
    try:
        parsed = json.loads(content)
        return {
            'key': key,
            'content': parsed,
            'content_type': 'application/json',
            'size': size,
            'last_modified': response['LastModified'].isoformat(),
            'is_json': True,
            'too_large': False,
        }
    except json.JSONDecodeError:
        return {
            'key': key,
            'content': content,
            'content_type': response.get('ContentType', 'text/plain'),
            'size': size,
            'last_modified': response['LastModified'].isoformat(),
            'is_json': False,
            'too_large': False,
        }


def generate_download_url(bucket: str, key: str, expiration: int = 900) -> str:
    """
    Generate a presigned URL for downloading a file.

    Args:
        bucket: S3 bucket name
        key: S3 object key
        expiration: URL expiration in seconds (default: 900 = 15 minutes)
    """
    return s3_client.generate_presigned_url(
        'get_object',
        Params={'Bucket': bucket, 'Key': key},
        ExpiresIn=expiration
    )


# =============================================================================
# Route Handlers
# =============================================================================

@validate({
    'prefix': {'type': str, 'max_length': 1024, 'default': ''},
    'bucket': {'type': str, 'max_length': 20, 'default': 'responses'},
    **CURSOR_QUERY_PARAM,
})
def _browse(event: dict[str, Any], context: Any, prefix: str, bucket: str, next_token: str | None = None) -> dict[str, Any]:
    """List one page of folder contents at the given prefix (``next_token`` continues it)."""
    # URL decode the prefix
    prefix = unquote(prefix) if prefix else ''

    # Path traversal validation
    path_error = validate_s3_path(prefix)
    if path_error:
        return validation_error(path_error, event, 'prefix')

    # Get the actual bucket and root prefix
    actual_bucket, root_prefix = get_bucket_and_prefix(bucket)
    if not actual_bucket:
        return validation_error(f'Invalid bucket type: {bucket}', event, 'bucket')

    valid, continuation_token = decode_browse_token(next_token, resolve_prefix(prefix, root_prefix))
    if not valid:
        return validation_error(CURSOR_ERROR_MESSAGE, event, 'next_token')

    result = list_prefixes(actual_bucket, prefix, root_prefix, continuation_token)
    result['bucket_type'] = bucket
    return success_response(result, event)


def _resolve_scoped_object(event: dict[str, Any], key: str, bucket: str) -> tuple[str, str] | dict[str, Any]:
    """Unquote, validate and root-scope a caller-supplied object key.

    Shared by `_get_file` and `_get_download` so both routes apply the same
    containment gate before touching S3.

    Returns:
        ``(actual_bucket, scoped_key)`` on success, or the 400 response to
        send when the key or bucket is refused.
    """
    # URL decode the key. Unquote BEFORE validating so `%2e%2e%2f` is caught.
    key = unquote(key)

    # Path traversal validation
    path_error = validate_s3_path(key)
    if path_error:
        return validation_error(path_error, event, 'key')

    # Get the actual bucket and its root prefix
    actual_bucket, root_prefix = get_bucket_and_prefix(bucket)
    if not actual_bucket:
        return validation_error(f'Invalid bucket type: {bucket}', event, 'bucket')

    scoped_key, scope_error = scope_key_to_root(key, root_prefix)
    if scoped_key is None:
        # scope_key_to_root answers exactly one of (key, None) / (None, message).
        return validation_error(str(scope_error), event, 'key')

    return actual_bucket, scoped_key


def _scoped_object_route(answer: Callable[[dict[str, Any], str, str], dict[str, Any]]) -> Callable[..., dict[str, Any]]:
    """A ``key`` / ``bucket`` route that hands ``answer`` the object only once it is confined to the bucket's root prefix.

    ``answer(event, actual_bucket, scoped_key)`` never sees the raw key; a key
    that fails validation or scoping is answered with its 400.
    """
    @validate({
        'key': {'required': True, 'type': str, 'max_length': 1024},
        'bucket': {'type': str, 'max_length': 20, 'default': 'responses'}
    })
    @functools.wraps(answer)
    def route(event: dict[str, Any], context: Any, key: str, bucket: str) -> dict[str, Any]:
        target = _resolve_scoped_object(event, key, bucket)
        if isinstance(target, dict):
            return target
        return answer(event, *target)

    return route


@_scoped_object_route
def _get_file(event: dict[str, Any], actual_bucket: str, scoped_key: str) -> dict[str, Any]:
    """Get file content for the given S3 key, confined to the bucket's root prefix."""
    result = get_file_content(actual_bucket, scoped_key)
    return success_response(result, event)


@_scoped_object_route
def _get_download(event: dict[str, Any], actual_bucket: str, scoped_key: str) -> dict[str, Any]:
    """Generate a presigned download URL, confined to the bucket's root prefix.

    The URL this returns is signed with the Lambda role's credentials and is
    bearer-shareable — no Cognito token is needed to redeem it — so the key must
    be scoped before it is signed, not after.
    """
    url = generate_download_url(actual_bucket, scoped_key)
    # Echo the key that was actually signed, not the raw input.
    return success_response({'download_url': url, 'key': scoped_key}, event)


# =============================================================================
# Main Handler
# =============================================================================

@api_handler
@route_handler({
    ('GET', '/file'): _get_file,
    ('GET', '/download'): _get_download,
    ('GET', None): _browse,
})
def handler(event: dict[str, Any], context: Any):
    """
    API Gateway handler for browsing raw responses.
    Routes handled by @route_handler decorator.
    """
