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
"""

import os
import sys

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
