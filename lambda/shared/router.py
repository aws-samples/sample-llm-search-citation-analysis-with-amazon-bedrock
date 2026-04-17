"""
Shared helpers for consolidated API Lambda routers.

Several API Lambdas act as thin routers that dispatch to sub-handlers living
in hyphenated Python files in the same directory (e.g. `manage-schedule.py`).
This module centralizes the boilerplate for loading and caching those
sub-handlers so each router file can stay small and focused on its route map.

Usage:
    from shared.router import HandlerLoader

    _handlers = HandlerLoader(__file__)

    def handler(event, context):
        ...
        return _handlers.get('trigger-analysis.py')(event, context)
"""

from __future__ import annotations

import importlib.util
import os
import sys
from typing import Callable, Dict


class HandlerLoader:
    """
    Lazily loads and caches Lambda sub-handlers from sibling .py files.

    Files with hyphenated names (not valid Python module names) are loaded
    via `importlib.util.spec_from_file_location`. Each file is loaded at most
    once per Lambda container (the function is cached), matching the previous
    per-router `_handler_cache` behavior.
    """

    def __init__(self, router_file: str) -> None:
        """
        Args:
            router_file: The router's `__file__`. Sub-handlers are resolved
                relative to this file's directory.
        """
        self._dir = os.path.dirname(os.path.abspath(router_file))
        self._cache: Dict[str, Callable] = {}

    def get(self, filename: str) -> Callable:
        """
        Return the `handler` callable exported by `filename`.

        Args:
            filename: Sub-handler filename (e.g. 'manage-schedule.py').

        Returns:
            The `handler` function from the loaded module.
        """
        cached = self._cache.get(filename)
        if cached is not None:
            return cached

        filepath = os.path.join(self._dir, filename)
        module_name = filename.replace('-', '_').replace('.py', '')
        spec = importlib.util.spec_from_file_location(module_name, filepath)
        if spec is None or spec.loader is None:
            raise ImportError(f"Could not load handler spec for {filepath!r}")

        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)

        handler_fn = getattr(module, 'handler', None)
        if handler_fn is None:
            raise AttributeError(
                f"Module {filename!r} has no 'handler' attribute"
            )

        self._cache[filename] = handler_fn
        return handler_fn


__all__ = ['HandlerLoader']
