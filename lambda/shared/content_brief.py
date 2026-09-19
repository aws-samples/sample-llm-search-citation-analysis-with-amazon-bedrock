"""Validation, source extraction, and prompt rendering for Content Studio group briefs."""

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

MAX_SELECTED_KEYWORDS = 50
MAX_LANDING_URL_LENGTH = 2048
MAX_CURRENT_COPY_LENGTH = 20_000
MAX_PROMPT_TEMPLATE_LENGTH = 6000
MAX_OUTPUT_LANGUAGE_LENGTH = 100
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
    IMPROVE_CURRENT_URL: """Improve the existing landing page for {brand} and the keyword group {group}.

Target keywords:
{keywords}

Current page text:
{current_copy}

Source context:
{landing_summary}

Mode requirement:
{mode_instructions}

Create a substantially improved, useful page rather than a light edit. Preserve accurate facts from the source, strengthen search intent coverage, and organize the draft for readers. Write in {output_language}.""",
    REWRITE_PASTED_COPY: """Rewrite the supplied landing-page copy for {brand} and the keyword group {group}.

Target keywords:
{keywords}

Current copy:
{current_copy}

Source context:
{landing_summary}

Mode requirement:
{mode_instructions}

Retain accurate source facts while improving clarity, structure, usefulness, and natural keyword coverage. Write in {output_language}.""",
    CREATE_NEW_LANDING_PAGE: """Create a new landing page for {brand} and the keyword group {group}.

Target keywords:
{keywords}

Source context:
{landing_summary}

Mode requirement:
{mode_instructions}

Build the page from the selected keyword intent without assuming a specific industry or inventing unverifiable facts. Write in {output_language}.""",
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

_STRUCTURED_OUTPUT_FOOTER = """Format your response with clear sections:
TITLE: [Your title here]
META: [150 character meta description]

[Your complete landing-page body here with ## headings and a useful FAQ section containing 5-8 questions and answers]

HEADINGS: [List the H2 headings you used, comma separated]
POINTS: [3 key takeaways as bullet points]"""

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


def _validate_keyword_ids(idea: dict[str, Any]) -> list[str] | ContentBriefValidationIssue:
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


def _validate_group_brief_fields(
    idea: dict[str, Any],
    url_validator: Callable[[str], tuple[bool, str]],
) -> dict[str, Any] | ContentBriefValidationIssue:
    client_id = _required_text(idea, 'id', MAX_GROUP_ID_LENGTH)
    if isinstance(client_id, ContentBriefValidationIssue):
        return client_id
    group_id = _required_text(idea, 'group_id', MAX_GROUP_ID_LENGTH)
    if isinstance(group_id, ContentBriefValidationIssue):
        return group_id
    mode = _validate_mode(idea)
    if isinstance(mode, ContentBriefValidationIssue):
        return mode
    keyword_ids = _validate_keyword_ids(idea)
    if isinstance(keyword_ids, ContentBriefValidationIssue):
        return keyword_ids
    source = _validate_source_fields(idea, mode, url_validator)
    if isinstance(source, ContentBriefValidationIssue):
        return source
    prompt_template = _required_text(idea, 'prompt_template', MAX_PROMPT_TEMPLATE_LENGTH)
    if isinstance(prompt_template, ContentBriefValidationIssue):
        return prompt_template
    template_error = validate_template_placeholders(prompt_template)
    if template_error:
        return ContentBriefValidationIssue('prompt_template', template_error)
    output_language = _required_text(idea, 'output_language', MAX_OUTPUT_LANGUAGE_LENGTH)
    if isinstance(output_language, ContentBriefValidationIssue):
        return output_language
    return {
        'id': client_id.strip(),
        'group_id': group_id.strip(),
        'content_angle': mode,
        'keyword_ids': keyword_ids,
        'landing_url': source['landing_url'],
        'current_copy': source['current_copy'],
        'prompt_template': prompt_template,
        'output_language': output_language.strip(),
    }


def canonicalize_group_brief(
    idea: dict[str, Any],
    groups_table: Any,
    keywords_table: Any,
    *,
    url_validator: Callable[[str], tuple[bool, str]] = validate_url_safe,
) -> tuple[dict[str, Any] | None, ContentBriefValidationIssue | None]:
    """Validate a request and replace client text with authoritative group data."""
    fields = _validate_group_brief_fields(idea, url_validator)
    if isinstance(fields, ContentBriefValidationIssue):
        return None, fields

    group = groups_table.get_item(Key={'id': fields['group_id']}).get('Item')
    if not group:
        return None, ContentBriefValidationIssue('group_id', 'Keyword group not found')
    group_name = group.get('name')
    if not isinstance(group_name, str) or not group_name.strip():
        return None, ContentBriefValidationIssue('group_id', 'Keyword group is unavailable')

    active_members = resolve_scope(
        {'mode': 'groups', 'group_ids': [fields['group_id']]}, keywords_table
    )
    members_by_id = {
        member['id']: member
        for member in active_members
        if isinstance(member.get('id'), str) and isinstance(member.get('keyword'), str)
    }
    selected_ids = fields['keyword_ids']
    if any(keyword_id not in members_by_id for keyword_id in selected_ids):
        return None, ContentBriefValidationIssue(
            'keyword_ids',
            'keyword_ids must contain only active keywords in the selected group',
        )

    selected_members = sorted(
        (members_by_id[keyword_id] for keyword_id in selected_ids),
        key=lambda member: (member['keyword'].casefold(), member['id']),
    )
    keyword_noun = 'keyword' if len(selected_members) == 1 else 'keywords'
    canonical = {
        'id': fields['id'],
        'type': GROUP_BRIEF_TYPE,
        'priority': 'medium',
        'title': f'Group Brief: {group_name}',
        'description': (
            f'Generate a complete landing page from {len(selected_members)} '
            f'selected active {keyword_noun}.'
        ),
        'keyword': group_name,
        'source': GROUP_BRIEF_TYPE,
        'actionable': True,
        'content_angle': fields['content_angle'],
        'group_id': fields['group_id'],
        'group_name': group_name,
        'keyword_ids': [member['id'] for member in selected_members],
        'keywords': [member['keyword'] for member in selected_members],
        'landing_url': fields['landing_url'],
        'current_copy': fields['current_copy'],
        'prompt_template': fields['prompt_template'],
        'output_language': fields['output_language'],
        'competitor_urls': [],
    }
    return canonical, None


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
    required_names = ['brand', 'group', 'keywords']
    if mode != CREATE_NEW_LANDING_PAGE:
        required_names.extend(['current_copy', 'landing_summary'])
    missing = [
        f'{name}: {replacements[name]}'
        for name in required_names
        if f'{{{name}}}' not in template
    ]
    return '\n'.join(missing)


def build_group_brief_prompt(
    idea: dict[str, Any], config: dict[str, Any]
) -> tuple[str, int]:
    """Build a safety-wrapped group brief prompt and report fetched source count."""
    current_copy, landing_summary, source_count = _source_content(idea)
    replacements = {
        'brand': wrap_user_input(_brand_name(config), 'brand'),
        'group': wrap_user_input(idea['group_name'], 'group', max_length=100),
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
        f'{_STRUCTURED_OUTPUT_FOOTER}'
    )
    return prompt, source_count


__all__ = [
    'ALLOWED_PLACEHOLDERS',
    'CREATE_NEW_LANDING_PAGE',
    'DEFAULT_PROMPT_TEMPLATES',
    'GROUP_BRIEF_MODES',
    'GROUP_BRIEF_TYPE',
    'IMPROVE_CURRENT_URL',
    'MAX_CURRENT_COPY_LENGTH',
    'MAX_EXTRACTED_TEXT_LENGTH',
    'MAX_LANDING_URL_LENGTH',
    'MAX_OUTPUT_LANGUAGE_LENGTH',
    'MAX_PROMPT_TEMPLATE_LENGTH',
    'MAX_SELECTED_KEYWORDS',
    'REWRITE_PASTED_COPY',
    'ContentBriefFetchError',
    'ContentBriefTemplateError',
    'ContentBriefValidationIssue',
    'build_group_brief_prompt',
    'canonicalize_group_brief',
    'fetch_landing_page_text',
    'html_to_text',
    'render_prompt_template',
    'validate_template_placeholders',
]
