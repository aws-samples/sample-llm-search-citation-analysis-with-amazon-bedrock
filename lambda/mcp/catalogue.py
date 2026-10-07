"""
The MCP tool catalogue: every operation the server offers and the API route it maps to.

Each entry is declarative: a name, the dashboard tab it mirrors, a description
an LLM can choose it by, synonyms for ``search_tools``, the OAuth scope and
admin requirement, a JSON Schema for its arguments and a ``route`` function
that turns validated arguments into the API Gateway request the invoker
replays against the existing API handler Lambdas.

``direct`` entries are advertised in ``tools/list``; the rest are reachable
through the meta tools (``search_tools`` → ``describe_tool`` → ``call_tool``)
so the default listing stays small. ``MCP_PINNED_TOOLS`` promotes catalogue
entries to the direct listing without a code change.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, NamedTuple

JsonObject = dict[str, Any]
RouteBuilder = Callable[[JsonObject], 'Route']


class InvalidArguments(ValueError):
    """Tool arguments that do not fit the tool's input schema (JSON-RPC ``-32602``)."""


class Route(NamedTuple):
    """One API Gateway request to replay against a router Lambda."""

    router: str
    method: str
    path: str
    resource: str
    path_params: dict[str, str] | None
    query: dict[str, str] | None
    body: JsonObject | None


@dataclass(frozen=True)
class Tool:
    """A catalogue operation; see the module docstring for the fields."""

    name: str
    tab: str
    description: str
    tags: tuple[str, ...]
    scope: str
    admin: bool
    direct: bool
    read_only: bool
    input_schema: JsonObject
    examples: tuple[JsonObject, ...]
    route: RouteBuilder
    shape: Callable[[Any], Any] | None = None


# --- JSON Schema fragments ---------------------------------------------------

def _schema(properties: Mapping[str, JsonObject], required: Sequence[str] = ()) -> JsonObject:
    schema: JsonObject = {'type': 'object', 'properties': dict(properties), 'additionalProperties': False}
    if required:
        schema['required'] = list(required)
    return schema


def _string(description: str) -> JsonObject:
    return {'type': 'string', 'description': description}


def _enum(description: str, values: Sequence[str]) -> JsonObject:
    return {'type': 'string', 'enum': list(values), 'description': description}


def _integer(description: str, minimum: int, maximum: int) -> JsonObject:
    return {'type': 'integer', 'minimum': minimum, 'maximum': maximum, 'description': description}


def _string_list(description: str, max_items: int | None = None) -> JsonObject:
    spec: JsonObject = {'type': 'array', 'items': {'type': 'string'}, 'description': description}
    if max_items is not None:
        spec['maxItems'] = max_items
    return spec


SCOPE_ARGUMENTS = ('group_id', 'keyword_ids', 'keyword', 'all')
_SCOPE_PROPERTIES: JsonObject = {
    'group_id': _string('Scope: a keyword group id'),
    'keyword_ids': _string_list('Scope: keyword ids', max_items=100),
    'keyword': _string('Scope: one keyword text'),
    'all': {'type': 'boolean', 'description': 'Scope: true = every active keyword'},
}
_SCOPE_RULE = 'Scope: one of group_id, keyword_ids, keyword, all.'

_ENGINES = ('openai', 'perplexity', 'gemini', 'claude')
_KEYWORD_STATUSES = ('active', 'inactive', 'paused')
_PRIORITIES = ('high', 'normal', 'low')
_PERIODS = ('day', 'week', 'month')
_PROVIDER = _enum('One AI engine', _ENGINES)
_PERSONA_ID = _string('Persona (query prompt) id')
_DAYS = _integer('Window in days', 1, 365)


# --- Request building ----------------------------------------------------------

def _query_value(value: Any) -> str:
    """A query-string value as API Gateway would deliver it."""
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, list):
        return ','.join(str(item) for item in value)
    return str(value)


def _query(arguments: JsonObject, *names: str) -> dict[str, str]:
    return {name: _query_value(arguments[name]) for name in names if arguments.get(name) is not None}


def _body(arguments: JsonObject, *names: str) -> JsonObject:
    return {name: arguments[name] for name in names if arguments.get(name) is not None}


def _scope_query(arguments: JsonObject, *, required: bool) -> dict[str, str]:
    """The scope parameter the report handlers expect, from the tool's scope arguments."""
    given = [name for name in SCOPE_ARGUMENTS if arguments.get(name) not in (None, False, '', [])]
    if len(given) > 1:
        raise InvalidArguments(f'Use exactly one of {", ".join(SCOPE_ARGUMENTS)}')
    if not given:
        if required:
            raise InvalidArguments(f'Provide one of {", ".join(SCOPE_ARGUMENTS)}')
        return {}
    name = given[0]
    if name == 'all':
        return {'scope': 'all'}
    return {name: _query_value(arguments[name])}


def _get_route(router: str, path: str, *params: str, scope: bool | None = None) -> RouteBuilder:
    """A GET route whose ``params`` become query parameters.

    ``scope`` adds the scope parameter: ``None`` means the endpoint takes none,
    ``False`` optional, ``True`` required.
    """
    def route(arguments: JsonObject) -> Route:
        query = _query(arguments, *params)
        if scope is not None:
            query.update(_scope_query(arguments, required=scope))
        return Route(router, 'GET', path, path, None, query or None, None)

    return route


def _dispatch_route(argument: str, routes: Mapping[str, RouteBuilder]) -> RouteBuilder:
    """A route chosen by the value of one enum argument (``kind``, ``view``)."""
    def route(arguments: JsonObject) -> Route:
        return routes[arguments[argument]](arguments)

    return route


def _keyword_mgmt(method: str, resource: str, body: JsonObject, item_id: str | None = None) -> Route:
    """A write against the keyword-mgmt router; ``{id}`` in ``resource`` is filled from ``item_id``."""
    path_params = {'id': item_id} if item_id is not None else None
    path = resource.replace('{id}', item_id) if item_id is not None else resource
    return Route('keyword-mgmt', method, path, resource, path_params, None, body)


_KEYWORD_FIELDS = ('keyword', 'status', 'region', 'language', 'category', 'priority', 'notes', 'group_ids')


def _create_group_route(arguments: JsonObject) -> Route:
    return _keyword_mgmt('POST', '/api/keyword-groups', _body(arguments, 'name', 'description'))


def _update_group_route(arguments: JsonObject) -> Route:
    return _keyword_mgmt('PUT', '/api/keyword-groups/{id}', _body(arguments, 'name', 'description'), arguments['group_id'])


def _add_keyword_route(arguments: JsonObject) -> Route:
    return _keyword_mgmt('POST', '/api/keywords', _body(arguments, *_KEYWORD_FIELDS))


def _update_keyword_route(arguments: JsonObject) -> Route:
    return _keyword_mgmt('PUT', '/api/keywords/{id}', _body(arguments, *_KEYWORD_FIELDS), arguments['keyword_id'])


def _membership_route(arguments: JsonObject) -> Route:
    body = {'add': arguments.get('add_keyword_ids') or [], 'remove': arguments.get('remove_keyword_ids') or []}
    return _keyword_mgmt('PUT', '/api/keyword-groups/{id}/keywords', body, arguments['group_id'])


# action -> (arguments it needs, route builder)
_MANAGE_ACTIONS: dict[str, tuple[tuple[str, ...], RouteBuilder]] = {
    'create_group': (('name',), _create_group_route),
    'update_group': (('group_id',), _update_group_route),
    'add': (('keyword',), _add_keyword_route),
    'update': (('keyword_id', 'keyword'), _update_keyword_route),
    'set_status': (('keyword_id', 'keyword', 'status'), _update_keyword_route),
    'set_membership': (('group_id',), _membership_route),
}


def _manage_keywords_route(arguments: JsonObject) -> Route:
    action = arguments['action']
    required, build = _MANAGE_ACTIONS[action]
    missing = [name for name in required if arguments.get(name) in (None, '')]
    if missing:
        raise InvalidArguments(f'{action} needs {", ".join(missing)}')
    return build(arguments)


_PROVIDER_FIELDS = ('id', 'name', 'enabled', 'configured', 'model')


def _provider_summary(data: Any) -> JsonObject:
    """``GET /api/providers`` without key material, health history or documentation links."""
    providers = data.get('providers', []) if isinstance(data, dict) else []
    return {'providers': [{field: item.get(field) for field in _PROVIDER_FIELDS} for item in providers if isinstance(item, dict)]}


# --- Argument validation -------------------------------------------------------

_JSON_TYPES: dict[str, type] = {'string': str, 'boolean': bool, 'array': list, 'object': dict}


def _is_json_type(value: Any, expected: str) -> bool:
    if expected == 'integer':
        return isinstance(value, int) and not isinstance(value, bool)
    return isinstance(value, _JSON_TYPES[expected])


def _check_range(name: str, value: int, spec: JsonObject) -> None:
    minimum, maximum = spec.get('minimum'), spec.get('maximum')
    if (minimum is not None and value < minimum) or (maximum is not None and value > maximum):
        raise InvalidArguments(f'{name} must be between {minimum} and {maximum}')


def _check_items(name: str, value: list[Any], spec: JsonObject) -> None:
    max_items = spec.get('maxItems')
    if max_items is not None and len(value) > max_items:
        raise InvalidArguments(f'{name} accepts at most {max_items} items')
    item_type = spec['items']['type']
    if any(not _is_json_type(item, item_type) for item in value):
        raise InvalidArguments(f'{name} items must be of type {item_type}')


def _check_argument(name: str, value: Any, spec: JsonObject) -> None:
    expected = spec['type']
    if not _is_json_type(value, expected):
        raise InvalidArguments(f'{name} must be of type {expected}')
    allowed = spec.get('enum')
    if allowed is not None and value not in allowed:
        raise InvalidArguments(f'{name} must be one of: {", ".join(allowed)}')
    if expected == 'integer':
        _check_range(name, value, spec)
    elif expected == 'array':
        _check_items(name, value, spec)


def validate_arguments(schema: JsonObject, arguments: Any) -> JsonObject:
    """``arguments`` checked against ``schema`` (type, enum, range, items, required, no unknown keys)."""
    if not isinstance(arguments, dict):
        raise InvalidArguments('arguments must be an object')
    properties: dict[str, JsonObject] = schema['properties']
    unknown = sorted(set(arguments) - set(properties))
    if unknown:
        raise InvalidArguments(f'Unknown argument(s): {", ".join(unknown)}')
    missing = [name for name in schema.get('required', ()) if arguments.get(name) is None]
    if missing:
        raise InvalidArguments(f'Missing required argument(s): {", ".join(missing)}')
    for name, value in arguments.items():
        if value is not None:
            _check_argument(name, value, properties[name])
    return arguments


# --- The catalogue --------------------------------------------------------------

def _tool(
    name: str,
    tab: str,
    description: str,
    tags: Sequence[str],
    schema: JsonObject,
    route: RouteBuilder,
    examples: Sequence[JsonObject],
    *,
    direct: bool = False,
    write: bool = False,
    shape: Callable[[Any], Any] | None = None,
) -> Tool:
    return Tool(
        name=name, tab=tab, description=description, tags=tuple(tags),
        scope='write' if write else 'read', admin=False, direct=direct, read_only=not write,
        input_schema=schema, examples=tuple(examples), route=route, shape=shape,
    )


_SETTINGS = 'Settings'
_REPORTS = 'Reports'
_CITATIONS = 'Citations'
_VISIBILITY = 'Visibility'
_BRAND_MENTIONS = 'Brand Mentions'
_EXAMPLE_GROUP = 'grp_123'
_EXAMPLE_KEYWORD = 'hotel coruña'

OPERATIONS: tuple[Tool, ...] = (
    _tool(
        'list_keyword_groups', _SETTINGS,
        'List keyword groups (folders) with their active keyword counts. Call it first to find a group_id for scoped reports.',
        ('groups', 'folders', 'group id', 'segments', 'collections', 'campaigns'),
        _schema({}), _get_route('keyword-mgmt', '/api/keyword-groups'), ({},), direct=True,
    ),
    _tool(
        'list_keywords', _SETTINGS,
        'List tracked keywords (id, text, status, priority, group_ids), filtered by group, status or priority. Paginated: pass next_token to continue.',
        ('keywords', 'tracked prompts', 'queries', 'search terms', 'keyword id', 'pagination', 'inventory'),
        _schema({
            'group_id': _string('Only keywords in this group'),
            'status': _enum('Only this status', _KEYWORD_STATUSES),
            'priority': _enum('Only this priority', _PRIORITIES),
            'limit': _integer('Page size', 1, 1000),
            'next_token': _string('Cursor from the previous page'),
        }),
        _get_route('keyword-mgmt', '/api/keywords', 'group_id', 'status', 'priority', 'limit', 'next_token'),
        ({'status': 'active'}, {'group_id': _EXAMPLE_GROUP, 'limit': 50}), direct=True,
    ),
    _tool(
        'get_brand_config', _SETTINGS,
        'Read the brand tracking configuration: industry, first-party brands and domains, tracked competitors, extraction settings.',
        ('brand', 'competitors', 'first party', 'domains', 'industry', 'configuration', 'tracked brands', 'own brand'),
        _schema({}), _get_route('brand-config', '/api/brand-config'), ({},), direct=True,
    ),
    _tool(
        'get_visibility', _VISIBILITY,
        'Visibility KPIs: mentions, mention rate, share of voice, average position, top-3 share, visibility score, '
        'citations, net sentiment, engine coverage; by brand, engine, source and keyword. ' + _SCOPE_RULE,
        ('share of voice', 'sov', 'kpi', 'kpis', 'visibility score', 'mention rate', 'average position', 'top 3',
         'net sentiment', 'engine coverage', 'metrics', 'how visible', 'performance'),
        _schema({**_SCOPE_PROPERTIES, 'brand': _string('Focus on one brand'), 'query_prompt_id': _PERSONA_ID}),
        _get_route('stats-insights', '/api/visibility', 'brand', 'query_prompt_id', scope=True),
        ({'group_id': _EXAMPLE_GROUP}, {'all': True}), direct=True,
    ),
    _tool(
        'get_report', _REPORTS,
        'Report data. kind=overview: KPIs, trend, movers, recommendations. trends: KPI time series. group_kpis: per-run '
        'KPI history (scope required). competitor: keywords a competitor outranks you on and its exclusive sources.',
        ('report', 'executive summary', 'overview', 'trend', 'history', 'time series', 'group kpis', 'competitor benchmark',
         'outranked', 'movers', 'improving', 'declining'),
        _schema({
            'kind': _enum('Which report', ('overview', 'trends', 'group_kpis', 'competitor')),
            **_SCOPE_PROPERTIES,
            'period': _enum('Trend bucket', _PERIODS),
            'days': _DAYS,
            'top': _integer('Movers per list (overview)', 1, 10),
            'competitor': _string('Competitor brand (competitor)'),
            'keyword_limit': _integer('Keywords per competitor (competitor)', 1, 100),
        }, ('kind',)),
        _dispatch_route('kind', {
            'overview': _get_route('stats-insights', '/api/reports/overview', 'period', 'days', 'top', scope=False),
            'trends': _get_route('stats-insights', '/api/trends', 'period', 'days', scope=False),
            'group_kpis': _get_route('stats-insights', '/api/reports/group-kpis', 'days', scope=True),
            'competitor': _get_route('stats-insights', '/api/reports/competitor', 'competitor', 'keyword_limit'),
        }),
        ({'kind': 'overview', 'days': 30}, {'kind': 'group_kpis', 'group_id': _EXAMPLE_GROUP, 'days': 90}), direct=True,
    ),
    _tool(
        'get_citations', _CITATIONS,
        'Citations. view=list: most-cited URLs with counts per engine, provider and brand totals. view=gaps: sources the '
        'engines cite that never cite you, by domain, with coverage rate. Scope optional (default: everything).',
        ('citations', 'sources', 'urls', 'cited pages', 'citation gaps', 'coverage', 'domains', 'links', 'references',
         'who gets cited'),
        _schema({
            'view': _enum('list or gaps', ('list', 'gaps')),
            **_SCOPE_PROPERTIES,
            'limit': _integer('Keywords to analyse for gaps', 1, 100),
        }, ('view',)),
        _dispatch_route('view', {
            'list': _get_route('citations-content', '/api/citations', scope=False),
            'gaps': _get_route('stats-insights', '/api/citation-gaps', 'limit', scope=False),
        }),
        ({'view': 'list', 'keyword': _EXAMPLE_KEYWORD}, {'view': 'gaps', 'group_id': _EXAMPLE_GROUP}), direct=True,
    ),
    _tool(
        'list_recommendations', 'Action Center',
        'Rule-based recommendations (Action Center): prioritised actions with status, impact and related keywords.',
        ('recommendations', 'action center', 'actions', 'to do', 'next steps', 'priorities', 'advice', 'what to fix'),
        _schema({}), _get_route('stats-insights', '/api/recommendations'), ({},), direct=True,
    ),
    _tool(
        'manage_keywords', _SETTINGS,
        'Change keywords and groups. action=create_group(name) | update_group(group_id) | add(keyword) | '
        'update(keyword_id, keyword) | set_status(keyword_id, keyword, status) | set_membership(group_id, add/remove ids).',
        ('create', 'update', 'add keyword', 'pause', 'deactivate', 'status', 'group membership', 'move keyword',
         'rename group', 'edit', 'new group'),
        _schema({
            'action': _enum('What to change', tuple(_MANAGE_ACTIONS)),
            'name': _string('Group name'),
            'description': _string('Group description'),
            'group_id': _string('Group id (update_group, set_membership)'),
            'keyword_id': _string('Keyword id (update, set_status)'),
            'keyword': _string('Keyword text; on update/set_status the stored text, to confirm identity'),
            'status': _enum('New status (set_status)', _KEYWORD_STATUSES),
            'region': _string('Region, default global'),
            'language': _string('Language code, default en'),
            'category': _string('Category'),
            'priority': _enum('Priority', _PRIORITIES),
            'notes': _string('Notes'),
            'group_ids': _string_list('Whole group membership of the keyword (add, update)'),
            'add_keyword_ids': _string_list('Keyword ids to add to the group (set_membership)'),
            'remove_keyword_ids': _string_list('Keyword ids to remove from the group (set_membership)'),
        }, ('action',)),
        _manage_keywords_route,
        ({'action': 'add', 'keyword': 'boutique hotel galicia', 'group_ids': [_EXAMPLE_GROUP]},
         {'action': 'set_status', 'keyword_id': 'kw_1', 'keyword': _EXAMPLE_KEYWORD, 'status': 'paused'}),
        direct=True, write=True,
    ),
    _tool(
        'list_providers', _SETTINGS,
        'AI engines and search providers with their enabled and configured flags and the model each one uses.',
        ('providers', 'engines', 'models', 'openai', 'perplexity', 'gemini', 'claude', 'brave', 'tavily', 'exa',
         'serpapi', 'firecrawl', 'enabled', 'configured', 'api key', 'which engines'),
        _schema({}), _get_route('config-mgmt', '/api/providers'), ({},), shape=_provider_summary,
    ),
    _tool(
        'list_personas', _SETTINGS,
        'Personas (query prompt templates) that rewrite each keyword before it is asked, with ids and enabled flags.',
        ('personas', 'query prompts', 'templates', 'persona id', 'query_prompt_id', 'audiences', 'buyer types'),
        _schema({}), _get_route('config-mgmt', '/api/query-prompts'), ({},),
    ),
    _tool(
        'get_dashboard_stats', 'Dashboard',
        'Dashboard totals: searches, citations, crawled pages, unique keywords and the last run time.',
        ('stats', 'totals', 'counts', 'summary', 'last run', 'dashboard', 'how many'),
        _schema({'provider': _PROVIDER}), _get_route('stats-insights', '/api/stats', 'provider'),
        ({}, {'provider': 'openai'}),
    ),
    _tool(
        'get_brand_mentions', _BRAND_MENTIONS,
        'What each engine answered for a keyword: the ChatGPT, Perplexity, Gemini and Claude responses, brands '
        'mentioned, positions, sentiment and citations; aggregated brands for a wider scope. ' + _SCOPE_RULE,
        ('answer', 'response', 'chatgpt', 'what the engine said', 'brands mentioned', 'position', 'rank', 'sentiment',
         'full response', 'prompt result', 'latest answer'),
        _schema({
            **_SCOPE_PROPERTIES,
            'provider': _PROVIDER,
            'classification': _enum('Only these brands', ('first_party', 'competitor', 'other')),
            'query_prompt_id': _PERSONA_ID,
            'timestamp': _string('A run timestamp from available_runs'),
        }),
        _get_route('brand-mentions', '/api/brand-mentions', 'provider', 'classification', 'query_prompt_id', 'timestamp',
                   scope=True),
        ({'keyword': _EXAMPLE_KEYWORD}, {'keyword': _EXAMPLE_KEYWORD, 'provider': 'openai'}),
    ),
    _tool(
        'get_persona_rankings', _BRAND_MENTIONS,
        'Brand rankings per persona for one keyword, with a cross-persona summary (average, best and worst rank).',
        ('persona', 'ranking', 'rank by audience', 'per persona', 'cross persona', 'who ranks first'),
        _schema({'keyword': _string('The keyword text'), 'query_prompt_id': _PERSONA_ID}, ('keyword',)),
        _get_route('persona-rankings', '/api/persona-rankings', 'keyword', 'query_prompt_id'),
        ({'keyword': _EXAMPLE_KEYWORD},),
    ),
    _tool(
        'get_prompt_insights', 'Prompt Insights',
        'Keywords (prompts) you win, lose or could win against competitors across engines, scored and ranked.',
        ('prompt insights', 'winning', 'losing', 'opportunities', 'win rate', 'prompts', 'where we lose'),
        _schema({
            'type': _enum('Which list', ('winning', 'losing', 'opportunities', 'all')),
            'limit': _integer('Prompts per list', 1, 100),
        }),
        _get_route('stats-insights', '/api/prompt-insights', 'type', 'limit'), ({'type': 'losing', 'limit': 10},),
    ),
    _tool(
        'list_recent_searches', 'Recent Searches',
        'Recent raw search runs (one row per keyword, engine and persona) with timestamps and status.',
        ('recent searches', 'runs', 'history', 'raw rows', 'search results', 'latest run', 'when did it run'),
        _schema({
            'keyword': _string('Only this keyword'),
            'provider': _string('Only this provider id'),
            'query_prompt_id': _PERSONA_ID,
            'limit': _integer('Rows', 1, 1000),
        }),
        _get_route('citations-content', '/api/searches', 'keyword', 'provider', 'query_prompt_id', 'limit'),
        ({'keyword': _EXAMPLE_KEYWORD, 'limit': 20},),
    ),
    _tool(
        'get_crawled_page', _CITATIONS,
        'Crawled content of a cited page by exact URL: summary, SEO analysis and screenshot link.',
        ('crawl', 'page', 'url', 'content', 'seo', 'screenshot', 'page summary', 'what is on the page'),
        _schema({
            'url': _string('The cited page URL, exactly as cited'),
            'include_history': {'type': 'boolean', 'description': 'Every crawl, not only the latest'},
            'limit': _integer('Rows', 1, 500),
        }, ('url',)),
        _get_route('citations-content', '/api/crawled-content', 'url', 'include_history', 'limit'),
        ({'url': 'https://example.com/guide'},),
    ),
    _tool(
        'get_sentiment_examples', _VISIBILITY,
        'Example answer passages with a given sentiment about your brands, per engine. ' + _SCOPE_RULE,
        ('sentiment', 'examples', 'quotes', 'excerpts', 'positive', 'negative', 'tone', 'answer passages'),
        _schema({
            **_SCOPE_PROPERTIES,
            'sentiment': _enum('Which sentiment', ('positive', 'neutral', 'mixed', 'negative')),
            'provider': _PROVIDER,
            'limit': _integer('Examples', 1, 50),
        }, ('sentiment',)),
        _get_route('stats-insights', '/api/visibility/sentiment-examples', 'sentiment', 'provider', 'limit', scope=True),
        ({'group_id': _EXAMPLE_GROUP, 'sentiment': 'negative'},),
    ),
    _tool(
        'list_custom_reports', _REPORTS,
        'Saved custom report definitions: title, blocks and window.',
        ('custom reports', 'saved reports', 'report builder', 'blocks'),
        _schema({}), _get_route('config-mgmt', '/api/custom-reports'), ({},),
    ),
)

_BY_NAME: dict[str, Tool] = {tool.name: tool for tool in OPERATIONS}


def find_operation(name: str) -> Tool:
    tool = _BY_NAME.get(name)
    if tool is None:
        raise InvalidArguments(f'Unknown tool: {name}')
    return tool


def pinned_tool_names() -> frozenset[str]:
    """Catalogue entries ``MCP_PINNED_TOOLS`` promotes to the direct listing."""
    return frozenset(name.strip() for name in os.environ.get('MCP_PINNED_TOOLS', '').split(',') if name.strip())


def listed_operations(full: bool = False) -> list[Tool]:
    """The operations ``tools/list`` advertises: direct and pinned, or everything with ``full``."""
    if full:
        return list(OPERATIONS)
    pinned = pinned_tool_names()
    return [tool for tool in OPERATIONS if tool.direct or tool.name in pinned]


def tool_annotations(read_only: bool) -> JsonObject:
    return {'readOnlyHint': read_only, 'destructiveHint': False, 'openWorldHint': False}


def public_tool(tool: Tool) -> JsonObject:
    """The ``tools/list`` entry of a catalogue operation."""
    return {
        'name': tool.name,
        'description': tool.description,
        'inputSchema': tool.input_schema,
        'annotations': tool_annotations(tool.read_only),
    }


# --- Meta tools -----------------------------------------------------------------

SEARCH_TOOLS_SCHEMA = _schema({'query': _string('What you need, in plain words')}, ('query',))
DESCRIBE_TOOL_SCHEMA = _schema({'name': _string('Operation name, from search_tools')}, ('name',))
CALL_TOOL_SCHEMA = _schema({
    'name': _string('Operation name, from search_tools'),
    'arguments': {'type': 'object', 'description': 'Arguments matching its inputSchema (see describe_tool)'},
}, ('name',))


def _meta(name: str, description: str, schema: JsonObject, *, read_only: bool) -> JsonObject:
    return {'name': name, 'description': description, 'inputSchema': schema, 'annotations': tool_annotations(read_only)}


META_TOOLS: tuple[JsonObject, ...] = (
    _meta(
        'search_tools',
        'Find more operations by free text: providers and models, personas, dashboard totals, engine answers for a '
        'keyword, persona rankings, prompt insights, recent runs, crawled pages, sentiment examples, custom reports.',
        SEARCH_TOOLS_SCHEMA, read_only=True,
    ),
    _meta(
        'describe_tool',
        'Full definition of an operation found with search_tools: input schema, examples, scope and admin requirement.',
        DESCRIBE_TOOL_SCHEMA, read_only=True,
    ),
    _meta(
        'call_tool',
        'Run an operation found with search_tools, with arguments matching its inputSchema.',
        CALL_TOOL_SCHEMA, read_only=False,
    ),
)


def tool_listing(full: bool = False) -> list[JsonObject]:
    """The ``tools`` array of ``tools/list``: listed operations followed by the meta tools."""
    return [public_tool(tool) for tool in listed_operations(full)] + [dict(meta) for meta in META_TOOLS]
