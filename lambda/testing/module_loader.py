"""Load hyphenated Lambda handler files as importable modules.

Handler files are named after their API resource (``get-reports-overview.py``),
so they cannot be imported with an ``import`` statement. Tests load them
through ``importlib`` instead; this module is the single copy of that dance.
"""

import importlib.util
import os
import sys
from types import ModuleType
from unittest.mock import MagicMock, patch


def module_name_for(filename: str, suffix: str = '_under_test') -> str:
    """``get-reports-overview.py`` -> ``get_reports_overview_under_test``."""
    return filename.replace('-', '_').removesuffix('.py') + suffix


def load_handler_module(directory: str, filename: str, module_name: str | None = None) -> ModuleType:
    """Execute ``directory/filename`` as a fresh module registered in ``sys.modules``.

    The module is executed with whatever patches the caller has active, so a
    test can stub boto3 or sibling helpers before loading. Each call produces
    a new module object; callers that want a shared instance cache it in a
    module-scoped fixture.
    """
    name = module_name or module_name_for(filename)
    spec = importlib.util.spec_from_file_location(name, os.path.join(directory, filename))
    if spec is None or spec.loader is None:
        raise ImportError(f'Cannot build an import spec for {filename} in {directory}')
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def load_handler_module_offline(directory: str, filename: str, module_name: str | None = None) -> ModuleType:
    """``load_handler_module`` with ``boto3.resource`` / ``boto3.client`` stubbed while the file executes.

    For handlers that build their AWS clients at import time and whose tests
    swap the module-level clients afterwards with ``patch.object``; the stubs
    are inert ``MagicMock`` objects and the patches end when the load does.
    """
    with (
        patch('boto3.resource', MagicMock(name='boto3.resource')),
        patch('boto3.client', MagicMock(name='boto3.client')),
    ):
        return load_handler_module(directory, filename, module_name)
