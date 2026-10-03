"""
``finite_number``: read a stored value as a finite float.

The visibility score itself is a KPI of ``shared.kpi_engine``
(``docs/kpi-definitions.md``).
"""

from __future__ import annotations

import math
from typing import Any


def finite_number(value: Any) -> float | None:
    """``value`` as a finite float; ``None`` for missing, boolean, non-numeric, NaN and infinite values."""
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None
