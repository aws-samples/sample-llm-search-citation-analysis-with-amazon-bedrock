"""
The consolidated API router Lambdas, reduced to their route maps.

``citations-content``, ``config-mgmt``, ``execution-mgmt`` and ``stats-insights``
each front several handler files behind one Lambda function. Apart from the
route map they are the same module: a logger, a ``HandlerLoader`` over the
sibling files and a ``handler`` that passes every event to ``dispatch_route``.
Building that handler here leaves each router file with its docstring and its
``ROUTE_MAP``::

    from shared.consolidated_router import route_map_handler

    ROUTE_MAP = {'/api/trigger-analysis': 'trigger-analysis.py'}

    handler = route_map_handler(__file__, ROUTE_MAP, __name__)
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping
from typing import Any

from shared.router import HandlerLoader, dispatch_route

LambdaHandler = Callable[[dict[str, Any], Any], dict[str, Any]]


def route_map_handler(router_file: str, route_map: Mapping[str, str], logger_name: str) -> LambdaHandler:
    """The Lambda ``handler`` of a consolidated router.

    ``router_file`` is the router's ``__file__`` (sub-handlers are loaded from
    its directory) and ``logger_name`` its ``__name__``, so log lines keep
    naming the router. ``route_map`` is tried in insertion order; see
    ``shared.router.dispatch_route`` for the matching rules and the 404.
    """
    logger = logging.getLogger(logger_name)
    logger.setLevel(logging.INFO)
    handlers = HandlerLoader(router_file)

    def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
        return dispatch_route(event, context, route_map, handlers, logger)

    return handler
