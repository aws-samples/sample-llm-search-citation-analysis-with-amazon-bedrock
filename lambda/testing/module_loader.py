"""Load hyphenated Lambda handler files as importable modules.

Handler files are named after their API resource (``get-reports-overview.py``),
so they cannot be imported with an ``import`` statement. Tests load them
through ``importlib`` instead; this module is the single copy of that dance.
"""

import importlib.util
import os
import sys
from types import ModuleType


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
