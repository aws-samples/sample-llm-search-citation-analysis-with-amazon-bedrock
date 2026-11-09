"""Pytest bootstrap shared by every Lambda test module.

Puts ``lambda/`` first on ``sys.path`` so tests import ``shared.*`` from
source, and the built shared layer second so runtime-only libraries
(openai, httpx, requests, beautifulsoup4) resolve without being installed in
the virtualenv. Pytest's default import mode already prepends each test
module's own directory, so hyphenated handler files next to a test stay
loadable through ``importlib`` exactly as before.

Before this file each test carried its own copy of this path shim; the
source tree now wins over a stale layer build in every test, not just the
ones that happened to import first.

Handlers build boto3 clients at import time, which needs a region. Lambda
always sets ``AWS_REGION``; a developer machine may not (no default profile
region), and collection then fails with ``NoRegionError``. Tests never reach
AWS, so a fixed placeholder region keeps them hermetic.
"""

import os
import sys
from collections.abc import Iterator
from typing import Any

import pytest

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')

_LAMBDA_DIR = os.path.dirname(os.path.abspath(__file__))
_LAYER_PYTHON_DIR = os.path.join(_LAMBDA_DIR, 'layer', 'python')

# Pytest has usually placed lambda/ on sys.path already, so re-anchor both
# entries explicitly: layer first, then lambda/ in front of it.
for _path in (_LAYER_PYTHON_DIR, _LAMBDA_DIR):
    if not os.path.isdir(_path):
        continue
    while _path in sys.path:
        sys.path.remove(_path)
    sys.path.insert(0, _path)


@pytest.fixture(autouse=True)
def change_events_bus() -> Iterator[Any]:
    """Every test publishes its change events (``shared.change_events``) into a fresh recorder, never to AWS.

    Imported here, not at the top: ``testing`` and ``shared`` resolve only once the path shim above has run. Its
    own ``MonkeyPatch``, not the ``monkeypatch`` fixture, so an autouse fixture does not reorder other fixtures'
    teardown. Request ``change_events_bus`` by name to read what a test published.
    """
    from testing.change_event_stubs import install_recorder
    with pytest.MonkeyPatch.context() as patcher:
        yield install_recorder(patcher)
