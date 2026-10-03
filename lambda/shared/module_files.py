"""
Execute a Python file as a module registered in ``sys.modules``.

Handler files are named after their API resource (``get-reports-overview.py``),
so they cannot be imported with an ``import`` statement; routers, sibling
loaders and tests execute them through ``importlib`` with this one helper.
"""

from __future__ import annotations

import importlib.util
import sys
from types import ModuleType


def exec_module_file(module_name: str, filepath: str) -> ModuleType | None:
    """Execute ``filepath`` as ``module_name`` (registered before it runs); ``None`` when no import spec can be built.

    Callers raise their own ``ImportError`` for ``None`` so the message names
    what they were loading.
    """
    spec = importlib.util.spec_from_file_location(module_name, filepath)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module
