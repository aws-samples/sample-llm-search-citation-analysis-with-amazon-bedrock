"""
Export row sources that page through the dashboard's own API routes (2.45.0).

A view's "Export all" must hold exactly the rows the view lists, with its
filters, all of them. Each source here replays the view's route against the
API router Lambda that serves it (the MCP server does the same), page after
page, until the route says the list is done. The export is therefore the
view by construction: same reads, same filters, same order, and a cap
removed from a route is removed from its export too.

- ``RouteList`` describes one sheet: the route, where its list sits in the
  answer, how the route pages it (``Paging``), and how an item becomes the
  sheet's columns (``Column``).
- ``RouteSource`` is the ``ExportRowSource`` of a view: its lists (one per
  sheet, optionally chosen by a parameter), the parameters it forwards, the
  ones it requires, and the invoker that reaches the routes.
- The cursor after a row is ``{list, token, skip}`` (``RoutePosition``,
  ``shared.export_route_position``): the list being read, the route cursor
  of the page holding the row, and how many rows of that page are done.
  Resuming fetches the same page again and skips them; a route's cursor
  answers the same page while the data behind it is unchanged (snapshot
  cursors answer ``cursor_expired`` once the build is replaced, which fails
  the export instead of mixing two builds). A live list whose rows can move
  (newest first, offset pages) names a ``resume_key``: the cursor then also
  holds the last row's identity, and a page starts after that row wherever
  it now is; a resumed list whose last row is gone fails the export.
- A page that leaves no row (a filter applied after the read emptied it)
  is followed by an ``ExportMark`` at the next page, so the checkpoint
  moves on even when no row is written for many pages.
- A ``202 computing`` answer (a view job is building the scope) is waited for
  within the deadline; the next chunk retries it. A page that says it is
  partial (``truncated`` …) is asked again and fails the export if it stays
  partial: an export is complete or it is an error, never a short file.

``lambda_route_invoker`` calls the routers named in ``EXPORT_API_FUNCTIONS``
(JSON ``{router: function name}``, as ``MCP_API_FUNCTIONS``) on behalf of the
export service; the caller's right to the view is checked by ``validate``
when the export is queued.
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable, Generator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Literal

import boto3
import requests
from botocore.config import Config

from shared.export_contract import (
    Caller,
    ExportCursor,
    ExportMark,
    ExportRow,
    ExportRows,
    ExportSheet,
    JsonScalar,
    RowsEnd,
)
from shared.export_route_position import (
    ExportCursorError,
    RoutePosition,
    RouteToken,
    answer_build,
    parse_position,
    row_identity,
)
from shared.kpi_engine import KPI_IDS, SPLIT_LABELS
from shared.request_deadline import Deadline
from shared.response_spill import SPILL_KEY

# The owner claim is what per-caller spend limits count an export's reads against.
from shared.seo_spend_limit import EXPORT_OWNER_CLAIM, EXPORT_SERVICE

#: The identity the routers see for an export read (``validate`` checked the real caller).
EXPORT_SERVICE_SUB = EXPORT_SERVICE


@dataclass
class ExportRead:
    """One chunk's route reads: whom they are made for, and how long a view job still computing asks to wait."""

    owner: str
    wait_seconds: float | None = None


_export_read: ContextVar[ExportRead | None] = ContextVar('export_read', default=None)


@contextmanager
def reading_for(owner: str) -> Generator[ExportRead]:
    """Every route read made inside names ``owner`` (the export's owner, as ``cognito:username`` names a caller).

    A route answering ``202 computing`` stops the reads and sets ``wait_seconds`` on the yielded ``ExportRead``:
    the export state machine waits that long before the next chunk, so no Lambda sleeps while a view job runs
    (TENETS.md, tenets 7 and 8).
    """
    read = ExportRead(owner)
    token = _export_read.set(read)
    try:
        yield read
    finally:
        _export_read.reset(token)


ADMIN_GROUP = 'Admin'
#: Seconds a router may take (its own timeout is 29 s).
ROUTER_READ_SECONDS = 35
#: Seconds to connect to Lambda.
ROUTER_CONNECT_SECONDS = 2
#: A route read starts only while more than this is left: one attempt (the next chunk retries) that
#: connects and reads within its timeouts still answers before the deadline, so the chunk reserve
#: (60 s after it) covers the spilled body fetch, the last part upload and the checkpoint.
INVOKE_START_SECONDS = ROUTER_CONNECT_SECONDS + ROUTER_READ_SECONDS + 1.0
#: ``(connect, read)`` seconds of a spilled body fetch (an S3 GET), within the chunk reserve.
SPILL_TIMEOUT_SECONDS = (2, 20)
#: Times a page that says it is partial is asked again before the export fails.
PARTIAL_RETRIES = 3
#: Longest wait for a view job between two asks.
MAX_COMPUTING_WAIT_SECONDS = 10.0
#: Largest spilled body read (a router's whole answer stays under 6 MiB; JSON may expand a little).
MAX_SPILL_BYTES = 12 * 1024 * 1024
#: Longest parameter value forwarded to a route.
MAX_PARAM_CHARS = 2_000
LIST_SEPARATOR = '; '


class ExportSourceError(Exception):
    """The source cannot produce the complete rows (a route failed, stayed partial, or the cursor is not its own)."""


type RouteMethod = Literal['GET', 'POST']


@dataclass(frozen=True)
class RouteRequest:
    """One read against an API router Lambda: a GET with its query, or a POST with its JSON body."""

    router: str
    path: str
    resource: str
    query: Mapping[str, str]
    path_params: Mapping[str, str] | None = None
    admin: bool = False
    method: RouteMethod = 'GET'
    body: Mapping[str, Any] | None = None
    """The JSON body of a POST (``None`` on a GET)."""


type RouteInvoker = Callable[[RouteRequest], tuple[int, Any]]


def route_event(request: RouteRequest) -> dict[str, Any]:
    """The API Gateway proxy event a router Lambda expects for ``request``."""
    claims: dict[str, Any] = {'sub': EXPORT_SERVICE_SUB, 'cognito:username': EXPORT_SERVICE_SUB}
    read = _export_read.get()
    if read is not None:
        claims[EXPORT_OWNER_CLAIM] = read.owner
    if request.admin:
        claims['cognito:groups'] = ADMIN_GROUP
    return {
        'httpMethod': request.method,
        'path': request.path,
        'resource': request.resource,
        'pathParameters': dict(request.path_params) if request.path_params else None,
        'queryStringParameters': dict(request.query) or None,
        'headers': {'Content-Type': 'application/json'},
        'body': None if request.body is None else json.dumps(request.body, separators=(',', ':')),
        'requestContext': {'authorizer': {'claims': claims}},
    }


_lambda_client: list[Any] = []


def router_client_config() -> Config:
    """The Lambda client's timeouts: one attempt per read, so a slow router cannot outrun ``INVOKE_START_SECONDS``."""
    return Config(
        read_timeout=ROUTER_READ_SECONDS, connect_timeout=ROUTER_CONNECT_SECONDS,
        retries={'mode': 'standard', 'total_max_attempts': 1},
    )


def _client() -> Any:
    if not _lambda_client:
        _lambda_client.append(boto3.client('lambda', config=router_client_config()))
    return _lambda_client[0]


def _decoded(raw: Any) -> Any:
    if not isinstance(raw, str) or not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {'error': raw}


def _spilled_body(body: Any) -> Any:
    """The body a spill pointer stands for (``shared.response_spill``), or ``body`` itself."""
    pointer = body.get(SPILL_KEY) if isinstance(body, dict) else None
    url = pointer.get('url') if isinstance(pointer, dict) else None
    if not isinstance(url, str) or not url.startswith('https://'):
        return body
    response = requests.get(url, timeout=SPILL_TIMEOUT_SECONDS, stream=True)
    response.raise_for_status()
    content = response.raw.read(MAX_SPILL_BYTES + 1, decode_content=True)
    if len(content) > MAX_SPILL_BYTES:
        raise ExportSourceError('A spilled API answer is larger than an export reads')
    return json.loads(content)


def lambda_route_invoker(request: RouteRequest) -> tuple[int, Any]:
    """``(statusCode, body)`` the router Lambda answers ``request`` with (spilled bodies followed)."""
    # ``EXPORT_API_FUNCTIONS``: the ``{router: function name}`` map of the API routers an export may read.
    functions: dict[str, str] = json.loads(os.environ.get('EXPORT_API_FUNCTIONS') or '{}')
    name = functions.get(request.router)
    if not name:
        raise ExportSourceError(f'No API function is configured for router {request.router}')
    response = _client().invoke(FunctionName=name, Payload=json.dumps(route_event(request)).encode('utf-8'))
    payload = json.loads(response['Payload'].read())
    if response.get('FunctionError') or not isinstance(payload, dict):
        raise ExportSourceError(f'The API handler for {request.path} failed')
    return int(payload.get('statusCode') or 500), _spilled_body(_decoded(payload.get('body')))


# --- What a list looks like ----------------------------------------------------------


def path_value(item: Any, path: str) -> Any:
    """``item[a][b]…`` for the dotted ``path``; ``None`` when a step is missing."""
    value = item
    for step in path.split('.'):
        if not isinstance(value, Mapping):
            return None
        value = value.get(step)
    return value


def cell(value: Any) -> JsonScalar:
    """A JSON value as one cell: scalars as they are, scalar lists joined, anything else as compact JSON."""
    if value is None or isinstance(value, str | int | float | bool):
        return value
    if isinstance(value, list | tuple) and all(isinstance(entry, str | int | float) for entry in value):
        return LIST_SEPARATOR.join(str(entry) for entry in value)
    return json.dumps(value, sort_keys=True, ensure_ascii=False, default=str)


@dataclass(frozen=True)
class Column:
    """A sheet column: its header and the dotted path of its value in a row item (default: the header)."""

    name: str
    path: str | None = None

    def value(self, item: Mapping[str, Any]) -> JsonScalar:
        return cell(path_value(item, self.path or self.name))


def columns(*names: str) -> tuple[Column, ...]:
    """Columns read from the item fields of the same name (``'header=dotted.path'`` renames)."""
    parsed = []
    for name in names:
        header, _, path = name.partition('=')
        parsed.append(Column(header, path or None))
    return tuple(parsed)


def kpi_columns(prefix: str = 'kpis') -> tuple[Column, ...]:
    """Every KPI of ``docs/kpi-definitions.md`` and the sentiment split, read under ``prefix`` (``''``: the item itself)."""
    base = f'{prefix}.' if prefix else ''
    return (
        *(Column(kpi, f'{base}{kpi}') for kpi in KPI_IDS),
        *(Column(f'sentiment_{label}', f'{base}sentiment_split.{label}') for label in SPLIT_LABELS),
    )


@dataclass(frozen=True)
class Paging:
    """How a route pages its list: a cursor token, an offset, or one answer."""

    kind: Literal['token', 'offset', 'single'] = 'token'
    request_param: str = 'next_token'
    """The query parameter carrying the cursor (token) or the offset."""
    response_key: str = 'next_token'
    """The dotted body key of the next page's token (``token`` paging)."""
    limit_param: str | None = 'limit'
    limit: int = 100
    more_key: str | None = None
    """``offset`` paging: the dotted body key saying whether rows follow (``has_more``); false ends the list without asking for an empty page."""


SINGLE = Paging('single', limit_param=None)


def _identity_rows(item: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    return [item]


@dataclass(frozen=True)
class RouteList:
    """One sheet of a source: a route's list, paged to its end."""

    sheet: str
    columns: tuple[Column, ...]
    router: str
    path: str
    items: str
    """The dotted body key of the list (``''``: the body is the list)."""
    paging: Paging = Paging()
    fixed: Mapping[str, str] = field(default_factory=dict)
    """Query parameters the list always sends (``view=brands`` …); export params never override them."""
    path_param: str | None = None
    """An export parameter that fills ``{id}`` in ``path``."""
    partial_flags: tuple[str, ...] = ('truncated',)
    """Dotted body keys that, when true, say the page is partial."""
    admin: bool = False
    rows_of: Callable[[Mapping[str, Any]], list[Mapping[str, Any]]] = _identity_rows
    """The rows one list item stands for (default: the item); flattens nested lists."""
    forwards: tuple[str, ...] | None = None
    """The export parameters this list's route takes (default: every parameter of the source)."""
    only_with: str | None = None
    """An export parameter without which this list is left out of the export (a list of one group …)."""
    only_without: str | None = None
    """An export parameter with which this list is left out (the job history when one job is exported …)."""
    matches: Mapping[str, str] = field(default_factory=dict)
    """``{export parameter: dotted row path}``: when the parameter is given, only rows whose value equals it (a filter the view applies on screen)."""
    resume_key: tuple[str, ...] = ()
    """
    Dotted row paths that identify a row (an id, or a table key). With one, a
    page starts after the last row written when that row is on it, so rows
    the route inserts at the head of a newest-first list between two reads
    (or that shift an offset page) are neither repeated nor skipped.
    """
    optional: bool = False
    """The route leaves ``items`` (and its paging key) out when the list does not apply: an empty, last page. Otherwise a missing list fails the export."""
    method: RouteMethod = 'GET'
    """``POST``: the forwarded parameters, the fixed ones and the paging travel as the JSON body, not the query."""
    json_params: tuple[str, ...] = ()
    """Export parameters holding JSON text (an object of filters, ``true``, a number): a POST body carries their decoded value."""
    max_rows_param: str | None = None
    """``offset`` paging: the export parameter capping the rows read (a confirmed row count); the last page asks only the rest."""
    reread_flag: str | None = None
    """
    A field sent ``true`` when a chunk asks again the page its cursor points
    into (an earlier chunk read it already): the route then answers only from
    what it stored, never with a new paid call, or refuses, which fails the export.
    """

    @property
    def export_sheet(self) -> ExportSheet:
        return ExportSheet(self.sheet, tuple(column.name for column in self.columns))


def _wanted(params: Mapping[str, str], route_list: RouteList, forwarded: tuple[str, ...]) -> dict[str, str]:
    names = forwarded if route_list.forwards is None else route_list.forwards
    query = {name: params[name] for name in names if params.get(name) not in (None, '')}
    query.update(route_list.fixed)
    if route_list.path_param:
        query.pop(route_list.path_param, None)
    return query


def json_param_problem(params: Mapping[str, str], names: tuple[str, ...]) -> str | None:
    """The 400 message when a parameter of ``names`` holds no JSON text, else ``None``."""
    for name in names:
        if params.get(name) in (None, ''):
            continue
        try:
            json.loads(params[name])
        except json.JSONDecodeError:
            return f'{name} must be JSON'
    return None


def _post_body(query: Mapping[str, str], route_list: RouteList) -> dict[str, Any]:
    """A POST route's body: the wanted parameters, JSON ones decoded."""
    return {name: json.loads(value) if name in route_list.json_params else value for name, value in query.items()}


def _max_rows(params: Mapping[str, str], route_list: RouteList) -> int | None:
    raw = params.get(route_list.max_rows_param, '') if route_list.max_rows_param else ''
    return int(raw) if raw.isdigit() else None


@dataclass(frozen=True)
class _Page:
    rows: list[Mapping[str, Any]]
    next_token: RouteToken


@dataclass(frozen=True)
class RouteSource:
    """The ``ExportRowSource`` of a view whose rows are its routes' complete lists."""

    view: str
    lists: tuple[RouteList, ...]
    params: tuple[str, ...] = ()
    """The view's query parameters forwarded to every route."""
    required: tuple[str, ...] = ()
    select: str | None = None
    """A parameter naming the one list (by sheet name) to export; ``None``: every list, in order."""
    invoker: RouteInvoker = lambda_route_invoker

    @property
    def sheets(self) -> tuple[ExportSheet, ...]:
        return tuple(route_list.export_sheet for route_list in self.lists)

    def _chosen(self, params: Mapping[str, str]) -> tuple[int, ...]:
        name = params.get(self.select) if self.select is not None else None
        return tuple(
            index for index, route_list in enumerate(self.lists)
            if (self.select is None or route_list.sheet == name)
            and (route_list.only_with is None or params.get(route_list.only_with, '').strip())
            and (route_list.only_without is None or not params.get(route_list.only_without, '').strip())
        )

    def _param_problem(self, params: Mapping[str, object]) -> str | None:
        allowed = {*self.params, *((self.select,) if self.select else ())}
        unknown = sorted(name for name in params if name not in allowed)
        if unknown:
            return f'Unknown parameter for the {self.view} export: {", ".join(unknown)}'
        invalid = sorted(name for name, value in params.items() if not isinstance(value, str) or len(value) > MAX_PARAM_CHARS)
        if invalid:
            return f'Invalid parameter value: {", ".join(invalid)}'
        return None

    def validate(self, params: Mapping[str, str], caller: Caller) -> str | None:
        problem = self._param_problem(params)
        if problem:
            return problem
        missing = sorted(name for name in self.required if not params.get(name, '').strip())
        if missing:
            return f'The {self.view} export needs: {", ".join(missing)}'
        chosen = self._chosen(params)
        if not chosen and self.select is None:
            return f'The {self.view} export has no list for these parameters'
        if not chosen:
            return f'{self.select} must be one of: {", ".join(route_list.sheet for route_list in self.lists)}'
        if any(self.lists[index].admin for index in chosen) and ADMIN_GROUP not in caller.groups:
            return f'Only an {ADMIN_GROUP} may export this list'
        return next(filter(None, (json_param_problem(params, self.lists[index].json_params) for index in chosen)), None)

    def rows(self, params: Mapping[str, str], cursor: ExportCursor | None, deadline: Deadline) -> ExportRows:
        chosen = self._chosen(params)
        try:
            position = parse_position(cursor, chosen)
        except ExportCursorError:
            raise ExportSourceError('The export cursor does not belong to this view') from None
        start = position.list_index
        build = position.build
        for index in chosen[chosen.index(start):] if start in chosen else ():
            reading = _ListReading(self, self.lists[index], index, params, build)
            end = yield from reading.rows(position, deadline)
            if end is RowsEnd.STOPPED:
                return end
            build = reading.build
            position = RoutePosition(index + 1, None, 0, build=build)
        return RowsEnd.FINISHED


@dataclass
class _ListReading:
    source: RouteSource
    route_list: RouteList
    index: int
    params: Mapping[str, str]
    build: tuple[str, str] | None
    """The snapshot build every answer must come from (set by the export's first scoped answer)."""

    def _pin(self, body: Mapping[str, Any] | list[Any]) -> None:
        """Pin the first scoped answer's build; refuse an answer from another one (a rebuild between two lists or pages)."""
        build = answer_build(body)
        if build is None:
            return
        if self.build is None:
            self.build = build
        elif build != self.build:
            raise ExportSourceError(f'The data of {self.route_list.path} was rebuilt while the export ran; start the export again')

    def _identity(self, row: Mapping[str, Any]) -> tuple[str, ...] | None:
        return row_identity(row, self.route_list.resume_key)

    def _start(self, page: _Page, position: RoutePosition, seeking: bool) -> tuple[int, bool]:
        """Where this page's unwritten rows begin, and whether the last written row is still to be found."""
        if position.last is None:
            return position.skip, False
        found = next((index for index, row in enumerate(page.rows) if self._identity(row) == position.last), None)
        if found is not None:
            return found + 1, False
        if seeking:
            # The head of the list moved on: every row of this page comes before the last one written.
            return len(page.rows), True
        return position.skip, False

    def rows(self, position: RoutePosition, deadline: Deadline) -> Generator[ExportRow | ExportMark, None, RowsEnd]:
        token, seeking = position.token, position.seeking
        # A row cursor (skip > 0) points into a page an earlier chunk read: ask it again only as stored.
        reread = position.skip > 0
        while True:
            page = self._page(token, deadline, reread=reread)
            reread = False
            if page is None:
                return RowsEnd.STOPPED
            start, seeking = self._start(page, position, seeking)
            last = position.last
            for at, row in enumerate(page.rows[start:], start=start + 1):
                values = tuple(column.value(row) for column in self.route_list.columns)
                last = self._identity(row)
                yield ExportRow(self.route_list.sheet, values, RoutePosition(self.index, token, at, last, build=self.build).cursor())
            if page.next_token is None and seeking:
                raise ExportSourceError(f'A row the export had reached is gone from {self.route_list.path}; start the export again')
            if page.next_token is None:
                return RowsEnd.FINISHED
            if page.next_token == token:
                raise ExportSourceError(f'{self.route_list.path} answered its own cursor as the next page')
            position = RoutePosition(self.index, page.next_token, 0, last, seeking, self.build)
            if len(page.rows) <= start:
                # Nothing of this page was written (a filter emptied it, or it is all before the last row): checkpoint the next page.
                yield ExportMark(position.cursor())
            token = page.next_token

    def _limit(self, token: RouteToken) -> int:
        """The rows a page asks for: the paging's limit, or only the rest of a capped list."""
        cap = _max_rows(self.params, self.route_list)
        if cap is None or self.route_list.paging.kind != 'offset':
            return self.route_list.paging.limit
        return max(min(self.route_list.paging.limit, cap - _offset(token)), 0)

    def _request(self, token: RouteToken, *, reread: bool = False) -> RouteRequest:
        route_list, paging = self.route_list, self.route_list.paging
        query = _wanted(self.params, route_list, self.source.params)
        path, path_params = route_list.path, None
        if route_list.path_param:
            item_id = self.params.get(route_list.path_param, '')
            path, path_params = path.replace('{id}', item_id), {'id': item_id}
        if route_list.method == 'POST':
            body = _post_body(query, route_list)
            if paging.limit_param:
                body[paging.limit_param] = self._limit(token)
            if token is not None or paging.kind == 'offset':
                body[paging.request_param] = _offset(token) if paging.kind == 'offset' else token
            if reread and route_list.reread_flag:
                body[route_list.reread_flag] = True
            return RouteRequest(route_list.router, path, route_list.path, {}, path_params, route_list.admin, 'POST', body)
        if paging.limit_param:
            query[paging.limit_param] = str(self._limit(token))
        if token is not None:
            query[paging.request_param] = str(token)
        if reread and route_list.reread_flag:
            query[route_list.reread_flag] = 'true'
        return RouteRequest(route_list.router, path, route_list.path, query, path_params, route_list.admin)

    def _page(self, token: RouteToken, deadline: Deadline, *, reread: bool = False) -> _Page | None:
        """
        The page at ``token``, or ``None`` when the deadline came first or a view job is still computing (the next
        chunk asks again; for a computing job, after the wait the state machine takes).

        A read starts only while more than ``INVOKE_START_SECONDS`` remain.

        ``None`` marks ``deadline`` cut: the source stopped for time, so the
        chunk must not take the end of its rows for the end of the list.
        """
        partial = 0
        while deadline.remaining() > INVOKE_START_SECONDS:
            status, body = self.source.invoker(self._request(token, reread=reread))
            if status == 202:
                # A view job is computing: stop here and let the state machine wait (never sleep in the Lambda).
                read = _export_read.get()
                if read is not None:
                    read.wait_seconds = _retry_after(body)
                return None
            if status != 200 or not isinstance(body, dict | list) or job_failed(body):
                raise ExportSourceError(f'{self.route_list.path} answered {status}: {_message(body)}')
            if any(path_value(body, flag) is True for flag in self.route_list.partial_flags):
                partial += 1
                if partial >= PARTIAL_RETRIES:
                    raise ExportSourceError(f'{self.route_list.path} kept answering a partial page')
                continue
            self._pin(body)
            return self._parsed(body, token)
        deadline.cut = True
        return None

    def _matching(self, row: Mapping[str, Any]) -> bool:
        wanted = {path: self.params[name] for name, path in self.route_list.matches.items() if self.params.get(name, '').strip()}
        return all(str(cell(path_value(row, path))) == value for path, value in wanted.items())

    def _parsed(self, body: Mapping[str, Any] | list[Any], token: RouteToken) -> _Page:
        items = body if not self.route_list.items else path_value(body, self.route_list.items)
        if items is None and self.route_list.optional:
            return _Page([], None)
        if items is None:
            raise ExportSourceError(f'{self.route_list.path} answered without its list {self.route_list.items}')
        if isinstance(items, Mapping):
            items = [items]
        if not isinstance(items, list):
            raise ExportSourceError(f'{self.route_list.path} has no list at {self.route_list.items}')
        rows = [row for item in items if isinstance(item, Mapping) for row in self.route_list.rows_of(item) if self._matching(row)]
        following = _next_token(self.route_list.paging, body, token, len(items))
        cap = _max_rows(self.params, self.route_list)
        if cap is not None and isinstance(following, int) and following >= cap:
            following = None
        return _Page(rows, following)


def _offset(token: RouteToken) -> int:
    return token if isinstance(token, int) else int(token or 0)


def _next_token(paging: Paging, body: Mapping[str, Any] | list[Any], token: RouteToken, count: int) -> RouteToken:
    """
    The token of the page after this one, ``None`` after the last page.

    A token-paged answer without its ``response_key`` (absent, not null)
    fails the export: a renamed key would otherwise end the list after one page.
    An offset page ends the list when it is short, or when its ``more_key`` is false.
    """
    if paging.kind == 'single':
        return None
    if paging.kind == 'offset':
        if paging.more_key is not None and path_value(body, paging.more_key) is False:
            return None
        return _offset(token) + count if count >= paging.limit else None
    parent_path, _, key = paging.response_key.rpartition('.')
    parent = path_value(body, parent_path) if parent_path else body
    if not isinstance(parent, Mapping) or key not in parent:
        raise ExportSourceError(f'an answer has no {paging.response_key} to page by')
    following = parent[key]
    return following if isinstance(following, str) and following else None


def job_failed(body: Mapping[str, Any] | list[Any]) -> bool:
    """A view job's one-off failure answer (``snapshot_artifacts.failed_body``)."""
    return isinstance(body, Mapping) and set(body) == {'status', 'message'} and body.get('status') == 'failed'


def _retry_after(body: Any) -> float:
    milliseconds = body.get('retry_after_ms') if isinstance(body, dict) else None
    seconds = milliseconds / 1000 if isinstance(milliseconds, int | float) and milliseconds > 0 else 2.0
    return min(seconds, MAX_COMPUTING_WAIT_SECONDS)


def _message(body: Any) -> str:
    if isinstance(body, dict):
        for key in ('error', 'message'):
            if isinstance(body.get(key), str):
                return body[key]
    return 'no message'
