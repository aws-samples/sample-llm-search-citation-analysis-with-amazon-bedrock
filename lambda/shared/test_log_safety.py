"""``log_text``: a request-derived value as one bounded log line."""

from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from shared.log_safety import LOG_TEXT_LIMIT, log_text


@pytest.mark.parametrize(('value', 'expected'), [
    pytest.param('sch-1a2b3c4d', 'sch-1a2b3c4d', id='plain-text-unchanged'),
    pytest.param('ok\n[ERROR] forged record', 'ok\\n[ERROR] forged record', id='newline-escaped'),
    pytest.param('a\r\nb', 'a\\nb', id='crlf-is-one-break'),
    pytest.param('a\rb', 'a\\rb', id='bare-carriage-return-escaped'),
    pytest.param(['Admin', 'Users'], "['Admin', 'Users']", id='non-strings-are-stringified'),
    pytest.param(None, 'None', id='none'),
])
def test_escapes_line_breaks_and_keeps_everything_else(value, expected):
    assert log_text(value) == expected


def test_cuts_a_long_value_with_an_ellipsis():
    assert log_text('x' * 300) == 'x' * LOG_TEXT_LIMIT + '…'


def test_honours_a_custom_limit():
    assert log_text('abcdef', limit=3) == 'abc…'


@given(st.text())
def test_never_returns_a_line_break_or_more_than_the_limit_plus_the_ellipsis(value):
    text = log_text(value)

    assert '\n' not in text
    assert '\r' not in text
    assert len(text) <= LOG_TEXT_LIMIT + 1
