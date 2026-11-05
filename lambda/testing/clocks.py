"""Fake monotonic clocks for ``shared.request_deadline.Deadline`` in time-budget tests."""

from __future__ import annotations

from shared.request_deadline import Deadline


class JumpClock:
    """A clock at 0 until ``jump()``, ``later`` seconds on from then: the budget runs out at one chosen moment."""

    def __init__(self, later: float = 3600.0) -> None:
        self.now = 0.0
        self.later = later

    def __call__(self) -> float:
        return self.now

    def jump(self) -> None:
        self.now = self.later

    def deadline(self, seconds: float, *_clock: object) -> Deadline:
        """A ``Deadline`` of ``seconds`` on this clock (patched in for the class ``Deadline``)."""
        return Deadline(seconds, self)


class SteppedClock(JumpClock):
    """A clock that moves ``step`` seconds on every reading, the first reading at 0."""

    def __init__(self, step: float) -> None:
        super().__init__()
        self.step = step
        self.now = -step

    def __call__(self) -> float:
        self.now += self.step
        return self.now


class SleepClock(JumpClock):
    """A clock that moves only when ``sleep`` (patched in for ``time.sleep``) is called."""

    def sleep(self, seconds: float) -> None:
        self.now += seconds
