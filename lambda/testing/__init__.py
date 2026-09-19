"""Test-only helpers shared by the Lambda test modules.

Nothing in this package ships in a Lambda asset or the shared layer; it exists
so the ``test_*.py`` files next to the handlers do not each carry their own copy
of the same import plumbing.
"""
