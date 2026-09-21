"""Validation, source extraction, and prompt rendering for Content Studio briefs."""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from bs4 import BeautifulSoup

from shared.constants import MAX_KEYWORD_LENGTH
from shared.keyword_groups import MAX_GROUP_ID_LENGTH, resolve_scope, validate_id_list
from shared.prompt_safety import untrusted_input_system_instruction, wrap_user_input
from shared.safe_fetch import fetch_following_validated_redirects
from shared.url_validator import validate_url_safe

GROUP_BRIEF_TYPE = 'group_brief'
IMPROVE_CURRENT_URL = 'improve_current_url'
REWRITE_PASTED_COPY = 'rewrite_pasted_copy'
CREATE_NEW_LANDING_PAGE = 'create_new_landing_page'
GROUP_BRIEF_MODES = (
    IMPROVE_CURRENT_URL,
    REWRITE_PASTED_COPY,
    CREATE_NEW_LANDING_PAGE,
)
CONTENT_BRIEF_SCOPE_MODES = ('groups', 'keywords')

MAX_SELECTED_KEYWORDS = 50
MAX_BATCH_KEYWORDS = 10
MAX_LANDING_URL_LENGTH = 2048
MAX_CURRENT_COPY_LENGTH = 20_000
MAX_PROMPT_TEMPLATE_LENGTH = 6000
MAX_OUTPUT_LANGUAGE_LENGTH = 100
MAX_TEMPLATE_NAME_LENGTH = 100
MAX_TEMPLATE_DESCRIPTION_LENGTH = 500
MAX_CONTENT_BRIEF_TEMPLATES = 100
MAX_EXTRACTED_TEXT_LENGTH = 8000
MAX_HTML_INPUT_LENGTH = 1_000_000
MAX_RESPONSE_CONTENT_LENGTH = 2_000_000
MAX_KEYWORDS_PROMPT_LENGTH = MAX_SELECTED_KEYWORDS * (MAX_KEYWORD_LENGTH + 2)
MAX_PLACEHOLDER_OCCURRENCES = 2
MAX_RENDERED_TEMPLATE_LENGTH = 120_000
RESPONSE_CHUNK_SIZE = 64 * 1024
FETCH_TIMEOUT_SECONDS = 5
FETCH_REDIRECT_HOPS = 3

ALLOWED_PLACEHOLDERS = frozenset({
    'brand',
    'group',
    'scope',
    'keywords',
    'current_copy',
    'landing_summary',
    'mode_instructions',
    'output_language',
})

_PLACEHOLDER_PATTERN = re.compile(r'\{([a-z][a-z0-9_]*)\}')
_REMOVED_HTML_ELEMENTS = (
    'script',
    'style',
    'noscript',
    'nav',
    'header',
    'footer',
    'form',
)
_HTML_CONTENT_TYPES = frozenset({'text/html', 'application/xhtml+xml'})
_USER_AGENT = 'Mozilla/5.0 (compatible; ContentStudioBot/1.0)'

DEFAULT_PROMPT_TEMPLATES = {
    IMPROVE_CURRENT_URL: """Improve the existing landing page for {brand} and the scope {scope}.

Target keywords:
{keywords}

Current page text:
{current_copy}

Source context:
{landing_summary}

Mode requirement:
{mode_instructions}

Create a substantially improved, useful page rather than a light edit. Preserve accurate facts from the source, strengthen search intent coverage, and organize the draft for readers. Write in {output_language}.""",
    REWRITE_PASTED_COPY: """Rewrite the supplied landing-page copy for {brand} and the scope {scope}.

Target keywords:
{keywords}

Current copy:
{current_copy}

Source context:
{landing_summary}

Mode requirement:
{mode_instructions}

Retain accurate source facts while improving clarity, structure, usefulness, and natural keyword coverage. Write in {output_language}.""",
    CREATE_NEW_LANDING_PAGE: """Create a new landing page for {brand} and the scope {scope}.

Target keywords:
{keywords}

Source context:
{landing_summary}

Mode requirement:
{mode_instructions}

Build the page from the selected keyword intent without assuming a specific industry or inventing unverifiable facts. Write in {output_language}.""",
}

_BUILTIN_TEMPLATE_DETAILS = {
    IMPROVE_CURRENT_URL: (
        'Improve current URL',
        'Rewrite and improve an existing landing page using its fetched source text.',
    ),
    REWRITE_PASTED_COPY: (
        'Rewrite pasted copy',
        'Rewrite supplied landing-page copy while preserving accurate source facts.',
    ),
    CREATE_NEW_LANDING_PAGE: (
        'Create new landing page',
        'Create a complete landing page from the selected keyword scope.',
    ),
}

_MODE_INSTRUCTIONS = {
    IMPROVE_CURRENT_URL: (
        'Use the fetched page text as the source, then rewrite and improve the complete landing page.'
    ),
    REWRITE_PASTED_COPY: (
        'Use the pasted copy as the source, then rewrite it into a complete landing page.'
    ),
    CREATE_NEW_LANDING_PAGE: (
        'Create a complete new landing page; no existing source content is required.'
    ),
}

CONTENT_OUTPUT_CONTRACT = """Return JSON only: exactly one JSON object with no Markdown fence, preamble, commentary, or trailing text.
Use exactly this schema and all five keys:
{
  "title": "string",
  "meta_description": "string of at most 160 characters",
  "body": "complete Markdown body as a JSON string",
  "suggested_headings": ["string"],
  "key_points": ["string"]
}
The title, meta_description, and body values must be strings. The suggested_headings and key_points values must be arrays containing only strings. Encode body line breaks as JSON escapes. Put only the useful draft in body; do not include response labels or introductory prose."""

_MANDATORY_OUTPUT_REQUIREMENTS = """Regardless of the editable template, return one complete landing-page draft grounded in the selected keywords. Include an SEO title, meta description, clear headings, substantial body copy, and a useful FAQ section with 5-8 questions and answers. Do not invent business-specific claims, statistics, certifications, prices, or guarantees that are absent from the source data."""


@dataclass(frozen=True)
class ContentBriefValidationIssue:
    """One field-specific validation failure suitable for a 400 response."""

    field: str
    message: str


class ContentBriefFetchError(RuntimeError):
    """A safe, user-facing failure while obtaining source page text."""


class ContentBriefTemplateError(ValueError):
    """A validated-template invariant failed during rendering."""


def builtin_content_brief_templates() -> list[dict[str, Any]]:
    """Return the three immutable templates in stable mode order."""
    templates: list[dict[str, Any]] = []
    for mode in GROUP_BRIEF_MODES:
        name, description = _BUILTIN_TEMPLATE_DETAILS[mode]
        templates.append({
            'id': f"builtin-{mode.replace('_', '-')}",
            'name': name,
            'description': description,
            'content_angle': mode,
            'prompt_template': DEFAULT_PROMPT_TEMPLATES[mode],
            'builtin': True,
            'created_by': None,
            'created_at': None,
            'updated_at': None,
        })
    return templates


def builtin_content_brief_template(template_id: str) -> dict[str, Any] | None:
    """Return one immutable template, or ``None`` when its id is unknown."""
    return next(
        (template for template in builtin_content_brief_templates() if template['id'] == template_id),
        None,
    )


def validate_template_placeholders(template: str) -> str | None:
    """Return a safe validation message for malformed or unknown placeholders."""
    cursor = 0
    names: Counter[str] = Counter()
    for match in _PLACEHOLDER_PATTERN.finditer(template):
        unmatched = template[cursor:match.start()]
        if '{' in unmatched or '}' in unmatched:
            return 'prompt_template contains a malformed placeholder'
        names[match.group(1)] += 1
        cursor = match.end()

    if '{' in template[cursor:] or '}' in template[cursor:]:
        return 'prompt_template contains a malformed placeholder'

    unknown = sorted(set(names) - ALLOWED_PLACEHOLDERS)
    if unknown:
        return f"prompt_template contains unknown placeholder(s): {', '.join(unknown)}"
    repeated = sorted(
        name for name, count in names.items() if count > MAX_PLACEHOLDER_OCCURRENCES
    )
    if repeated:
        return f"prompt_template repeats placeholder(s) too many times: {', '.join(repeated)}"
    return None


def render_prompt_template(template: str, values: dict[str, str]) -> str:
    """Substitute only allowlisted placeholders without invoking string formatting."""
    error = validate_template_placeholders(template)
    if error:
        raise ContentBriefTemplateError(error)
    rendered = _PLACEHOLDER_PATTERN.sub(lambda match: values[match.group(1)], template)
    if len(rendered) > MAX_RENDERED_TEMPLATE_LENGTH:
        raise ContentBriefTemplateError(
            'prompt_template expands beyond the safe rendered limit'
        )
    return rendered


def html_to_text(html: str | None, max_chars: int = MAX_EXTRACTED_TEXT_LENGTH) -> str:
    """Remove non-content HTML elements, normalize whitespace, and cap output."""
    if not isinstance(html, str) or max_chars <= 0:
        return ''
    soup = BeautifulSoup(html[:MAX_HTML_INPUT_LENGTH], 'html.parser')
    for element in soup.find_all(_REMOVED_HTML_ELEMENTS):
        element.decompose()
    normalized = re.sub(r'\s+', ' ', soup.get_text(' ', strip=True)).strip()
    return normalized[:max_chars]


def _required_text(
    idea: dict[str, Any], field: str, max_length: int
) -> str | ContentBriefValidationIssue:
    value = idea.get(field)
    if not isinstance(value, str):
        return ContentBriefValidationIssue(field, f'{field} must be a string')
    if not value.strip():
        return ContentBriefValidationIssue(field, f'{field} is required')
    if len(value) > max_length:
        return ContentBriefValidationIssue(
            field, f'{field} must be at most {max_length} characters'
        )
    return value


def _optional_text(
    idea: dict[str, Any], field: str, max_length: int
) -> str | ContentBriefValidationIssue:
    value = idea.get(field, '')
    if not isinstance(value, str):
        return ContentBriefValidationIssue(field, f'{field} must be a string')
    if len(value) > max_length:
        return ContentBriefValidationIssue(
            field, f'{field} must be at most {max_length} characters'
        )
    return value


def _validate_mode(idea: dict[str, Any]) -> str | ContentBriefValidationIssue:
    mode = idea.get('content_angle')
    if mode not in GROUP_BRIEF_MODES:
        allowed = ', '.join(GROUP_BRIEF_MODES)
        return ContentBriefValidationIssue(
            'content_angle', f'content_angle must be one of: {allowed}'
        )
    return str(mode)


def _legacy_keyword_ids(idea: dict[str, Any]) -> list[str] | ContentBriefValidationIssue:
    keyword_ids, error = validate_id_list(
        idea.get('keyword_ids'), field='keyword_ids', limit=MAX_SELECTED_KEYWORDS
    )
    if error:
        return ContentBriefValidationIssue('keyword_ids', error)
    if not keyword_ids:
        return ContentBriefValidationIssue(
            'keyword_ids', 'keyword_ids must contain between 1 and 50 active group members'
        )
    return keyword_ids


def _scope_shape_issue(scope: dict[str, Any], mode: str, field: str) -> ContentBriefValidationIssue | None:
    expected = {'mode', field}
    if set(scope) != expected:
        return ContentBriefValidationIssue(
            'scope', f'scope for {mode} mode must contain exactly mode and {field}'
        )
    return None


def _validate_scope_descriptor(
    value: Any,
) -> dict[str, Any] | ContentBriefValidationIssue:
    if not isinstance(value, dict):
        return ContentBriefValidationIssue('scope', 'scope must be an object')
    mode = value.get('mode')
    if mode not in CONTENT_BRIEF_SCOPE_MODES:
        return ContentBriefValidationIssue(
            'scope.mode', 'scope.mode must be one of: groups, keywords'
        )
    field = 'group_ids' if mode == 'groups' else 'keyword_ids'
    shape_issue = _scope_shape_issue(value, mode, field)
    if shape_issue:
        return shape_issue
    limit = 1 if mode == 'groups' else MAX_SELECTED_KEYWORDS
    ids, error = validate_id_list(value.get(field), field=f'scope.{field}', limit=limit)
    if error:
        return ContentBriefValidationIssue(f'scope.{field}', error)
    if mode == 'groups' and len(ids or []) != 1:
        return ContentBriefValidationIssue(
            'scope.group_ids', 'scope.group_ids must contain exactly one id'
        )
    if mode == 'keywords' and not ids:
        return ContentBriefValidationIssue(
            'scope.keyword_ids', 'scope.keyword_ids must contain between 1 and 50 active keyword ids'
        )
    return {'mode': mode, field: ids}


def _normalized_scope(
    idea: dict[str, Any],
) -> tuple[dict[str, Any], str | None, ContentBriefValidationIssue | None]:
    if 'scope' in idea:
        scope = _validate_scope_descriptor(idea.get('scope'))
        if isinstance(scope, ContentBriefValidationIssue):
            return {}, None, scope
        return scope, None, None

    group_id = _required_text(idea, 'group_id', MAX_GROUP_ID_LENGTH)
    if isinstance(group_id, ContentBriefValidationIssue):
        return {}, None, group_id
    keyword_ids = _legacy_keyword_ids(idea)
    if isinstance(keyword_ids, ContentBriefValidationIssue):
        return {}, None, keyword_ids
    return (
        {'keyword_ids': keyword_ids},
        group_id.strip(),
        None,
    )


def _validate_landing_url(
    landing_url: str,
    mode: str,
    url_validator: Callable[[str], tuple[bool, str]],
) -> ContentBriefValidationIssue | None:
    if mode != IMPROVE_CURRENT_URL:
        return None
    if not landing_url.strip():
        return ContentBriefValidationIssue(
            'landing_url', 'landing_url is required for improve current URL mode'
        )
    is_safe, error = url_validator(landing_url.strip())
    if not is_safe:
        return ContentBriefValidationIssue('landing_url', f'landing_url is invalid: {error}')
    return None


def _validate_source_fields(
    idea: dict[str, Any],
    mode: str,
    url_validator: Callable[[str], tuple[bool, str]],
) -> dict[str, str] | ContentBriefValidationIssue:
    landing_url = _optional_text(idea, 'landing_url', MAX_LANDING_URL_LENGTH)
    if isinstance(landing_url, ContentBriefValidationIssue):
        return landing_url
    current_copy = _optional_text(idea, 'current_copy', MAX_CURRENT_COPY_LENGTH)
    if isinstance(current_copy, ContentBriefValidationIssue):
        return current_copy
    if mode == REWRITE_PASTED_COPY and not current_copy.strip():
        return ContentBriefValidationIssue(
            'current_copy', 'current_copy is required for rewrite pasted copy mode'
        )
    issue = _validate_landing_url(landing_url, mode, url_validator)
    if issue:
        return issue
    return {
        'landing_url': landing_url.strip() if mode == IMPROVE_CURRENT_URL else '',
        'current_copy': current_copy if mode == REWRITE_PASTED_COPY else '',
    }


def _selected_scope_template_issue(
    prompt_template: str,
    scope: dict[str, Any],
    legacy_group_id: str | None,
) -> ContentBriefValidationIssue | None:
    if legacy_group_id is None and scope['mode'] == 'keywords' and '{group}' in prompt_template:
        return ContentBriefValidationIssue(
            'prompt_template',
            'prompt_template cannot use {group} with a selected-keyword scope; use {scope} instead',
        )
    return None


def _validate_group_brief_fields(
    idea: dict[str, Any],
    url_validator: Callable[[str], tuple[bool, str]],
) -> dict[str, Any] | ContentBriefValidationIssue:
    client_id = _required_text(idea, 'id', MAX_GROUP_ID_LENGTH)
    if isinstance(client_id, ContentBriefValidationIssue):
        return client_id
    scope, legacy_group_id, scope_issue = _normalized_scope(idea)
    if scope_issue:
        return scope_issue
    mode = _validate_mode(idea)
    if isinstance(mode, ContentBriefValidationIssue):
        return mode
    source = _validate_source_fields(idea, mode, url_validator)
    if isinstance(source, ContentBriefValidationIssue):
        return source
    prompt_template = _required_text(idea, 'prompt_template', MAX_PROMPT_TEMPLATE_LENGTH)
    if isinstance(prompt_template, ContentBriefValidationIssue):
        return prompt_template
    template_error = validate_template_placeholders(prompt_template)
    if template_error:
        return ContentBriefValidationIssue('prompt_template', template_error)
    template_scope_issue = _selected_scope_template_issue(
        prompt_template, scope, legacy_group_id
    )
    if template_scope_issue:
        return template_scope_issue
    output_language = _required_text(idea, 'output_language', MAX_OUTPUT_LANGUAGE_LENGTH)
    if isinstance(output_language, ContentBriefValidationIssue):
        return output_language
    return {
        'id': client_id.strip(),
        'scope': scope,
        'legacy_group_id': legacy_group_id,
        'content_angle': mode,
        'landing_url': source['landing_url'],
        'current_copy': source['current_copy'],
        'prompt_template': prompt_template,
        'output_language': output_language.strip(),
    }


def _authoritative_group(
    groups_table: Any, group_id: str, field: str
) -> tuple[dict[str, Any] | None, ContentBriefValidationIssue | None]:
    group = groups_table.get_item(Key={'id': group_id}).get('Item')
    if not group:
        return None, ContentBriefValidationIssue(field, 'Keyword group not found')
    group_name = group.get('name')
    if not isinstance(group_name, str) or not group_name.strip():
        return None, ContentBriefValidationIssue(field, 'Keyword group is unavailable')
    return {'id': group_id, 'name': group_name.strip()}, None


def _members_by_id(members: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        member['id']: member
        for member in members
        if isinstance(member.get('id'), str)
        and isinstance(member.get('keyword'), str)
        and member['keyword'].strip()
    }


def _sorted_members(members: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        members,
        key=lambda member: (member['keyword'].casefold(), member['id']),
    )


def _resolve_new_group_scope(
    scope: dict[str, Any], groups_table: Any, keywords_table: Any
) -> tuple[list[dict[str, Any]], dict[str, Any] | None, ContentBriefValidationIssue | None]:
    group_id = scope['group_ids'][0]
    group, issue = _authoritative_group(groups_table, group_id, 'scope.group_ids')
    if issue:
        return [], None, issue
    members = _sorted_members(resolve_scope(scope, keywords_table))
    if not members:
        return [], None, ContentBriefValidationIssue(
            'scope.group_ids', 'Keyword group has no active keywords'
        )
    if len(members) > MAX_SELECTED_KEYWORDS:
        return [], None, ContentBriefValidationIssue(
            'scope.group_ids', 'Keyword group has more than 50 active keywords'
        )
    return members, group, None


def _resolve_selected_scope(
    scope: dict[str, Any], keywords_table: Any
) -> tuple[list[dict[str, Any]], ContentBriefValidationIssue | None]:
    members = resolve_scope(scope, keywords_table)
    by_id = _members_by_id(members)
    selected_ids = scope['keyword_ids']
    if any(keyword_id not in by_id for keyword_id in selected_ids):
        return [], ContentBriefValidationIssue(
            'scope.keyword_ids',
            'scope.keyword_ids must contain only active existing keywords',
        )
    return _sorted_members([by_id[keyword_id] for keyword_id in selected_ids]), None


def _resolve_legacy_scope(
    fields: dict[str, Any], groups_table: Any, keywords_table: Any
) -> tuple[list[dict[str, Any]], dict[str, Any] | None, ContentBriefValidationIssue | None]:
    group_id = fields['legacy_group_id']
    group, issue = _authoritative_group(groups_table, group_id, 'group_id')
    if issue:
        return [], None, issue
    active_members = resolve_scope(
        {'mode': 'groups', 'group_ids': [group_id]}, keywords_table
    )
    by_id = _members_by_id(active_members)
    selected_ids = fields['scope']['keyword_ids']
    if any(keyword_id not in by_id for keyword_id in selected_ids):
        return [], None, ContentBriefValidationIssue(
            'keyword_ids',
            'keyword_ids must contain only active keywords in the selected group',
        )
    members = _sorted_members([by_id[keyword_id] for keyword_id in selected_ids])
    return members, group, None


def _resolve_brief_scope(
    fields: dict[str, Any], groups_table: Any, keywords_table: Any
) -> tuple[list[dict[str, Any]], dict[str, Any] | None, ContentBriefValidationIssue | None]:
    if fields['legacy_group_id'] is not None:
        return _resolve_legacy_scope(fields, groups_table, keywords_table)
    if fields['scope']['mode'] == 'groups':
        return _resolve_new_group_scope(fields['scope'], groups_table, keywords_table)
    members, issue = _resolve_selected_scope(fields['scope'], keywords_table)
    return members, None, issue


def _scope_label(
    members: list[dict[str, Any]], group: dict[str, Any] | None
) -> str:
    if group is not None:
        return group['name']
    if len(members) == 1:
        return members[0]['keyword']
    return f'{len(members)} selected keywords'


def canonicalize_group_brief(
    idea: dict[str, Any],
    groups_table: Any,
    keywords_table: Any,
    *,
    url_validator: Callable[[str], tuple[bool, str]] = validate_url_safe,
) -> tuple[dict[str, Any] | None, ContentBriefValidationIssue | None]:
    """Validate a request and replace all scope display text with authoritative data."""
    fields = _validate_group_brief_fields(idea, url_validator)
    if isinstance(fields, ContentBriefValidationIssue):
        return None, fields

    members, group, issue = _resolve_brief_scope(fields, groups_table, keywords_table)
    if issue:
        return None, issue

    keyword_ids = [member['id'] for member in members]
    keywords = [member['keyword'] for member in members]
    scope = (
        {'mode': 'groups', 'group_ids': [group['id']]}
        if group is not None and fields['legacy_group_id'] is None
        else {'mode': 'keywords', 'keyword_ids': keyword_ids}
    )
    label = _scope_label(members, group)
    canonical: dict[str, Any] = {
        'id': fields['id'],
        'type': GROUP_BRIEF_TYPE,
        'priority': 'medium',
        'title': f'Group Brief: {label}',
        'description': (
            f'Generate a complete landing page from {len(members)} selected active keywords.'
        ),
        'keyword': label,
        'source': GROUP_BRIEF_TYPE,
        'actionable': True,
        'content_angle': fields['content_angle'],
        'scope': scope,
        'scope_label': label,
        'keyword_ids': keyword_ids,
        'keywords': keywords,
        'landing_url': fields['landing_url'],
        'current_copy': fields['current_copy'],
        'prompt_template': fields['prompt_template'],
        'output_language': fields['output_language'],
        'competitor_urls': [],
    }
    if group is not None:
        canonical['group_id'] = group['id']
        canonical['group_name'] = group['name']
    return canonical, None


def single_keyword_brief(
    canonical: dict[str, Any], *, idea_id: str, keyword_id: str, keyword: str
) -> dict[str, Any]:
    """Derive one canonical batch child from an already validated parent brief."""
    child = dict(canonical)
    child.update({
        'id': idea_id,
        'title': f'Group Brief: {keyword}',
        'description': 'Generate a complete landing page from 1 selected active keyword.',
        'keyword': keyword,
        'scope': {'mode': 'keywords', 'keyword_ids': [keyword_id]},
        'scope_label': keyword,
        'keyword_ids': [keyword_id],
        'keywords': [keyword],
    })
    return child


def _declared_response_too_large(response: Any) -> bool:
    declared_length = response.headers.get('Content-Length')
    try:
        return int(declared_length) > MAX_RESPONSE_CONTENT_LENGTH
    except (TypeError, ValueError):
        return False


def _collect_bounded_body(response: Any) -> bytearray:
    """Stream the response body, refusing non-byte chunks and oversized payloads."""
    body = bytearray()
    for chunk in response.iter_content(chunk_size=RESPONSE_CHUNK_SIZE):
        if not chunk:
            continue
        if not isinstance(chunk, bytes):
            raise ContentBriefFetchError('Could not read the landing URL content.')
        if len(body) + len(chunk) > MAX_RESPONSE_CONTENT_LENGTH:
            raise ContentBriefFetchError(
                'The landing URL response is too large to process.'
            )
        body.extend(chunk)
    return body


def _read_bounded_response_text(response: Any) -> str:
    if _declared_response_too_large(response):
        response.close()
        raise ContentBriefFetchError('The landing URL response is too large to process.')

    try:
        body = _collect_bounded_body(response)
    except ContentBriefFetchError:
        raise
    except Exception as error_cause:
        raise ContentBriefFetchError('Could not read the landing URL content.') from error_cause
    finally:
        response.close()

    encoding = response.encoding if isinstance(response.encoding, str) else 'utf-8'
    try:
        return bytes(body).decode(encoding or 'utf-8', errors='replace')
    except LookupError:
        return bytes(body).decode('utf-8', errors='replace')


def fetch_landing_page_text(
    url: str,
    *,
    fetcher: Callable[..., tuple[Any | None, str | None, str]] = (
        fetch_following_validated_redirects
    ),
) -> tuple[str, str]:
    """Fetch validated HTML and return bounded readable text plus source context."""
    response, final_url, error = fetcher(
        url,
        timeout=FETCH_TIMEOUT_SECONDS,
        max_hops=FETCH_REDIRECT_HOPS,
        stream=True,
        headers={'User-Agent': _USER_AGENT, 'Accept': 'text/html,application/xhtml+xml'},
    )
    if error or response is None:
        raise ContentBriefFetchError(
            'Could not fetch the landing URL. Check that it is publicly accessible and try again.'
        )
    if not 200 <= response.status_code < 300:
        response.close()
        raise ContentBriefFetchError(
            'The landing URL did not return a successful response.'
        )

    content_type = response.headers.get('Content-Type', '').split(';', 1)[0].strip().lower()
    if content_type not in _HTML_CONTENT_TYPES:
        response.close()
        raise ContentBriefFetchError('The landing URL must return HTML content.')

    page_html = _read_bounded_response_text(response)
    try:
        page_text = html_to_text(page_html)
    except Exception as error_cause:
        raise ContentBriefFetchError('Could not read the landing URL content.') from error_cause
    if not page_text:
        raise ContentBriefFetchError(
            'The landing URL did not contain readable page text.'
        )
    return page_text, f'Current page fetched from {final_url or url}'


def _brand_name(config: dict[str, Any]) -> str:
    tracked_brands = config.get('tracked_brands')
    if not isinstance(tracked_brands, dict):
        return 'your brand'
    first_party = tracked_brands.get('first_party')
    if not isinstance(first_party, list) or not first_party:
        return 'your brand'
    first_name = first_party[0]
    return first_name if isinstance(first_name, str) and first_name.strip() else 'your brand'


def _source_content(idea: dict[str, Any]) -> tuple[str, str, int]:
    mode = idea['content_angle']
    if mode == IMPROVE_CURRENT_URL:
        page_text, summary = fetch_landing_page_text(idea['landing_url'])
        return page_text, summary, 1
    if mode == REWRITE_PASTED_COPY:
        return idea['current_copy'], 'Current copy supplied for rewriting', 0
    return '', 'No source content supplied; create the page from selected keyword intent', 0


def _required_context(
    template: str, replacements: dict[str, str], mode: str
) -> str:
    required_names = ['brand', 'scope', 'keywords']
    if mode != CREATE_NEW_LANDING_PAGE:
        required_names.extend(['current_copy', 'landing_summary'])
    missing = [
        f'{name}: {replacements[name]}'
        for name in required_names
        if f'{{{name}}}' not in template
    ]
    return '\n'.join(missing)


def _idea_scope_label(idea: dict[str, Any]) -> str:
    """Return current or legacy authoritative scope text, refusing absent context."""
    for field in ('scope_label', 'group_name', 'keyword'):
        value = idea.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()
    raise ContentBriefTemplateError('Content brief scope label is unavailable')


def build_group_brief_prompt(
    idea: dict[str, Any], config: dict[str, Any]
) -> tuple[str, int]:
    """Build a safety-wrapped content brief prompt and report fetched source count."""
    current_copy, landing_summary, source_count = _source_content(idea)
    scope_label = _idea_scope_label(idea)
    group_name = idea.get('group_name')
    group_label = group_name if isinstance(group_name, str) and group_name.strip() else scope_label
    replacements = {
        'brand': wrap_user_input(_brand_name(config), 'brand'),
        'group': wrap_user_input(group_label, 'group'),
        'scope': wrap_user_input(scope_label, 'scope', max_length=MAX_KEYWORD_LENGTH),
        'keywords': wrap_user_input(
            ', '.join(idea['keywords']),
            'keywords',
            max_length=MAX_KEYWORDS_PROMPT_LENGTH,
        ),
        'current_copy': wrap_user_input(
            current_copy, 'current_copy', max_length=MAX_CURRENT_COPY_LENGTH
        ),
        'landing_summary': wrap_user_input(
            landing_summary, 'landing_summary', max_length=MAX_LANDING_URL_LENGTH + 100
        ),
        'mode_instructions': _MODE_INSTRUCTIONS[idea['content_angle']],
        'output_language': wrap_user_input(
            idea['output_language'], 'output_language', max_length=MAX_OUTPUT_LANGUAGE_LENGTH
        ),
    }
    rendered_template = render_prompt_template(idea['prompt_template'], replacements)
    required_context = _required_context(
        idea['prompt_template'], replacements, idea['content_angle']
    )
    context_appendix = (
        f'\n\nRequired brief data:\n{required_context}' if required_context else ''
    )
    language = replacements['output_language']
    mode_instruction = _MODE_INSTRUCTIONS[idea['content_angle']]
    prompt = (
        f'{untrusted_input_system_instruction()}\n\n'
        f'{rendered_template}'
        f'{context_appendix}\n\n'
        f'Required mode behavior: {mode_instruction}\n\n'
        f'{_MANDATORY_OUTPUT_REQUIREMENTS}\n\n'
        f'Write every output field and the complete body in {language}.\n\n'
        f'{CONTENT_OUTPUT_CONTRACT}'
    )
    return prompt, source_count


__all__ = [
    'ALLOWED_PLACEHOLDERS',
    'CONTENT_BRIEF_SCOPE_MODES',
    'CONTENT_OUTPUT_CONTRACT',
    'CREATE_NEW_LANDING_PAGE',
    'DEFAULT_PROMPT_TEMPLATES',
    'GROUP_BRIEF_MODES',
    'GROUP_BRIEF_TYPE',
    'IMPROVE_CURRENT_URL',
    'MAX_BATCH_KEYWORDS',
    'MAX_CONTENT_BRIEF_TEMPLATES',
    'MAX_CURRENT_COPY_LENGTH',
    'MAX_EXTRACTED_TEXT_LENGTH',
    'MAX_LANDING_URL_LENGTH',
    'MAX_OUTPUT_LANGUAGE_LENGTH',
    'MAX_PROMPT_TEMPLATE_LENGTH',
    'MAX_SELECTED_KEYWORDS',
    'MAX_TEMPLATE_DESCRIPTION_LENGTH',
    'MAX_TEMPLATE_NAME_LENGTH',
    'REWRITE_PASTED_COPY',
    'ContentBriefFetchError',
    'ContentBriefTemplateError',
    'ContentBriefValidationIssue',
    'build_group_brief_prompt',
    'builtin_content_brief_template',
    'builtin_content_brief_templates',
    'canonicalize_group_brief',
    'fetch_landing_page_text',
    'html_to_text',
    'render_prompt_template',
    'single_keyword_brief',
    'validate_template_placeholders',
]
