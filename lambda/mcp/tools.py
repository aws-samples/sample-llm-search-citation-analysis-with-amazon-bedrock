"""
``tools/call``: direct tools, the catalogue behind the meta tools, and the meta tools themselves.

``search_tools`` → ``describe_tool`` → ``call_tool`` is how a client reaches
the operations that are not advertised directly. ``call_tool`` runs the named
operation through exactly the same authorization and invoker as a direct
tool; only the audit line differs (``tool`` names ``call_tool``, ``operation``
names what ran). Spend operations (``estimate_*`` / ``start_*``) run through
``spend.run_spend``, every other operation through ``invoke.run_operation``.
"""

from __future__ import annotations

from typing import Any

from auth import Caller
from catalogue import (
    CALL_TOOL_SCHEMA,
    DESCRIBE_TOOL_SCHEMA,
    SEARCH_TOOLS_SCHEMA,
    JsonObject,
    Tool,
    find_operation,
    validate_arguments,
)
from invoke import run_operation, tool_result
from spend import run_spend
from tool_search import search_tools


def _search(arguments: Any) -> JsonObject:
    query = validate_arguments(SEARCH_TOOLS_SCHEMA, arguments)['query']
    matches = search_tools(query)
    found = [{'name': tool.name, 'description': tool.description, 'tab': tool.tab} for tool in matches]
    return tool_result(f'{len(found)} tool(s) match {query!r}', {'tools': found})


def _describe(tool: Tool) -> JsonObject:
    described: JsonObject = {
        'name': tool.name,
        'description': tool.description,
        'inputSchema': tool.input_schema,
        'examples': list(tool.examples),
        'scope': tool.scope,
        'admin': tool.admin,
        'readOnlyHint': tool.read_only,
    }
    if tool.spend is not None:
        described['spend'] = {'family': tool.spend.family, 'step': tool.spend.step}
    return described


def _describe_tool(arguments: Any) -> JsonObject:
    tool = find_operation(validate_arguments(DESCRIBE_TOOL_SCHEMA, arguments)['name'])
    return tool_result(f'{tool.name}: {tool.description}', _describe(tool))


def _run(tool_name: str, operation: Tool, arguments: Any, caller: Caller) -> JsonObject:
    if operation.spend is not None:
        return run_spend(tool_name, operation, arguments, caller)
    return run_operation(tool_name, operation, arguments, caller)


def _call_tool(arguments: Any, caller: Caller) -> JsonObject:
    valid = validate_arguments(CALL_TOOL_SCHEMA, arguments)
    return _run('call_tool', find_operation(valid['name']), valid.get('arguments') or {}, caller)


def call_tool(name: str, arguments: Any, caller: Caller) -> JsonObject:
    """The result of ``tools/call`` for ``name``; ``InvalidArguments`` for an unknown tool or bad arguments."""
    if name == 'search_tools':
        return _search(arguments)
    if name == 'describe_tool':
        return _describe_tool(arguments)
    if name == 'call_tool':
        return _call_tool(arguments, caller)
    return _run(name, find_operation(name), arguments, caller)
