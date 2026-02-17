"""
Browse Raw Responses API Lambda

Provides S3 bucket browsing capabilities for raw API responses and screenshots.
Supports listing folders/files and fetching file content.

Endpoints:
    GET /api/raw-responses/browse?prefix=path/to/folder&bucket=responses|screenshots
    GET /api/raw-responses/file?key=path/to/file.json&bucket=responses|screenshots
    GET /api/raw-responses/download?key=path/to/file.json&bucket=responses|screenshots
"""

import json
import boto3
import sys
import logging
from typing import Dict, Any, Optional
import os
from urllib.parse import unquote

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.decorators import api_handler, validate, route_handler
from shared.api_response import success_response, validation_error

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

s3_client = boto3.client('s3')

# Fail-fast: Required environment variables
RAW_RESPONSES_BUCKET = os.environ['RAW_RESPONSES_BUCKET']
SCREENSHOTS_BUCKET = os.environ.get('SCREENSHOTS_BUCKET', '')

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


def validate_s3_path(path: str) -> Optional[str]:
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


def list_prefixes(bucket: str, prefix: str = '', root_prefix: str = 'raw-responses/') -> Dict[str, Any]:
    """
    List folders and files at a given S3 prefix.
    Returns both common prefixes (folders) and objects (files).
    """
    # Ensure prefix ends with / if not empty and not already ending with /
    if prefix and not prefix.endswith('/'):
        prefix = prefix + '/'
    
    # For root level, we want to list under the root prefix
    if not prefix:
        prefix = root_prefix
    elif not prefix.startswith(root_prefix):
        prefix = root_prefix + prefix
    
    response = s3_client.list_objects_v2(
        Bucket=bucket,
        Prefix=prefix,
        Delimiter='/'
    )
    
    folders = []
    files = []
    
    # Extract folder names from CommonPrefixes
    for cp in response.get('CommonPrefixes', []):
        folder_path = cp['Prefix']
        # Get just the folder name (last part before trailing /)
        folder_name = folder_path.rstrip('/').split('/')[-1]
        folders.append({
            'name': folder_name,
            'path': folder_path,
            'type': 'folder'
        })
    
    # Extract file info from Contents
    for obj in response.get('Contents', []):
        key = obj['Key']
        # Skip the prefix itself
        if key == prefix:
            continue
        # Get just the file name
        file_name = key.split('/')[-1]
        if file_name:  # Skip empty names
            # Determine if this is an image
            is_image = file_name.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp'))
            files.append({
                'name': file_name,
                'path': key,
                'type': 'image' if is_image else 'file',
                'size': obj['Size'],
                'last_modified': obj['LastModified'].isoformat()
            })
    
    # Sort folders and files by name (newest first for date folders)
    folders.sort(key=lambda x: x['name'], reverse=True)
    files.sort(key=lambda x: x['name'], reverse=True)  # Newest first for timestamps
    
    return {
        'prefix': prefix,
        'folders': folders,
        'files': files,
        'total_folders': len(folders),
        'total_files': len(files)
    }


def get_file_content(bucket: str, key: str) -> Dict[str, Any]:
    """
    Get the content of a specific S3 file.
    """
    try:
        response = s3_client.get_object(Bucket=bucket, Key=key)
    except s3_client.exceptions.NoSuchKey:
        raise Exception(f"File not found: {key}")
    
    content = response['Body'].read().decode('utf-8')
    
    # Try to parse as JSON for pretty display
    try:
        parsed = json.loads(content)
        return {
            'key': key,
            'content': parsed,
            'content_type': 'application/json',
            'size': response['ContentLength'],
            'last_modified': response['LastModified'].isoformat(),
            'is_json': True
        }
    except json.JSONDecodeError:
        return {
            'key': key,
            'content': content,
            'content_type': response.get('ContentType', 'text/plain'),
            'size': response['ContentLength'],
            'last_modified': response['LastModified'].isoformat(),
            'is_json': False
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
    'bucket': {'type': str, 'max_length': 20, 'default': 'responses'}
})
def _browse(event: Dict[str, Any], context: Any, prefix: str, bucket: str) -> Dict[str, Any]:
    """List folder contents at the given prefix."""
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
    
    result = list_prefixes(actual_bucket, prefix, root_prefix)
    result['bucket_type'] = bucket
    return success_response(result, event)


@validate({
    'key': {'required': True, 'type': str, 'max_length': 1024},
    'bucket': {'type': str, 'max_length': 20, 'default': 'responses'}
})
def _get_file(event: Dict[str, Any], context: Any, key: str, bucket: str) -> Dict[str, Any]:
    """Get file content for the given S3 key."""
    # URL decode the key
    key = unquote(key)
    
    # Path traversal validation
    path_error = validate_s3_path(key)
    if path_error:
        return validation_error(path_error, event, 'key')
    
    # Get the actual bucket
    actual_bucket, _ = get_bucket_and_prefix(bucket)
    if not actual_bucket:
        return validation_error(f'Invalid bucket type: {bucket}', event, 'bucket')
    
    result = get_file_content(actual_bucket, key)
    return success_response(result, event)


@validate({
    'key': {'required': True, 'type': str, 'max_length': 1024},
    'bucket': {'type': str, 'max_length': 20, 'default': 'responses'}
})
def _get_download(event: Dict[str, Any], context: Any, key: str, bucket: str) -> Dict[str, Any]:
    """Generate a presigned download URL for the given S3 key."""
    # URL decode the key
    key = unquote(key)
    
    # Path traversal validation
    path_error = validate_s3_path(key)
    if path_error:
        return validation_error(path_error, event, 'key')
    
    # Get the actual bucket
    actual_bucket, _ = get_bucket_and_prefix(bucket)
    if not actual_bucket:
        return validation_error(f'Invalid bucket type: {bucket}', event, 'bucket')
    
    url = generate_download_url(actual_bucket, key)
    return success_response({'download_url': url, 'key': key}, event)


# =============================================================================
# Main Handler
# =============================================================================

@api_handler
@route_handler({
    ('GET', '/file'): _get_file,
    ('GET', '/download'): _get_download,
    ('GET', None): _browse,
})
def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    API Gateway handler for browsing raw responses.
    Routes handled by @route_handler decorator.
    """
    pass  # Routes handle everything
