"""The export contract: view ids shared with the dashboard, export params, object keys, callers."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, get_args

import pytest

from shared.export_contract import (
    DOWNLOAD_URL_SECONDS,
    EXPORT_RETENTION_DAYS,
    EXPORT_VIEWS,
    MAX_RUNNING_EXPORTS_PER_USER,
    MULTIPART_MIN_PART_BYTES,
    XLSX_SHEET_ROWS,
    Caller,
    ExportFormat,
    ExportStatus,
    caller_from_event,
    export_object_key,
    export_params,
)

_WEB_EXPORTS = Path(__file__).resolve().parents[2] / 'web' / 'src' / 'types' / 'domain' / 'exports.ts'
#: The views matrix's 27 dashboard row sources (S1-S27) and the 9 SEO ones (S28-S36, 2.45.0).
_VIEWS_MATRIX_SOURCES = 36


def _web_views() -> list[str]:
    """The entries of the web ``EXPORT_VIEWS`` array, in source order."""
    match = re.search(
        r'export const EXPORT_VIEWS = \[(.*?)\] as const;', _WEB_EXPORTS.read_text(encoding='utf-8'), flags=re.DOTALL,
    )
    assert match is not None, 'web EXPORT_VIEWS array not found'
    return re.findall(r"'([a-z0-9-]+)'", match.group(1))


def _web_union(name: str) -> list[str]:
    """The members of a string-literal union ``export type <name> = 'a' | 'b';``."""
    match = re.search(rf'export type {name} = (.*?);', _WEB_EXPORTS.read_text(encoding='utf-8'))
    assert match is not None, f'web {name} union not found'
    return re.findall(r"'([a-z]+)'", match.group(1))


def _event(claims: dict[str, Any]) -> dict[str, Any]:
    return {'requestContext': {'authorizer': {'claims': claims}}}


class TestViews:
    def test_the_dashboard_lists_the_same_views_in_the_same_order(self) -> None:
        assert _web_views() == list(EXPORT_VIEWS)

    def test_there_is_one_view_per_views_matrix_row_source(self) -> None:
        assert len(EXPORT_VIEWS) == _VIEWS_MATRIX_SOURCES

    def test_view_ids_are_unique(self) -> None:
        assert len(set(EXPORT_VIEWS)) == len(EXPORT_VIEWS)

    def test_view_ids_are_kebab_case(self) -> None:
        assert [view for view in EXPORT_VIEWS if not re.fullmatch(r'[a-z0-9]+(-[a-z0-9]+)*', view)] == []

    def test_the_dashboard_formats_match(self) -> None:
        assert _web_union('ExportFormat') == list(get_args(ExportFormat.__value__))

    def test_the_dashboard_statuses_match(self) -> None:
        assert _web_union('ExportStatus') == list(get_args(ExportStatus.__value__))


class TestLimits:
    def test_xlsx_sheet_rows_leave_one_row_of_excels_limit_for_the_header(self) -> None:
        assert XLSX_SHEET_ROWS + 1 == 2 ** 20

    def test_multipart_parts_are_at_least_five_mebibytes(self) -> None:
        assert MULTIPART_MIN_PART_BYTES == 5_242_880

    def test_job_limits_match_the_contract(self) -> None:
        assert (MAX_RUNNING_EXPORTS_PER_USER, EXPORT_RETENTION_DAYS, DOWNLOAD_URL_SECONDS) == (5, 7, 900)


class TestExportParams:
    def test_keeps_scope_filter_and_sort_params(self) -> None:
        query = {'group_id': 'g1', 'market_id': 'es-es', 'provider': 'openai', 'sort': 'citation_count'}
        assert export_params(query) == query

    def test_drops_limit_offset_and_next_token(self) -> None:
        assert export_params({'keyword': 'hotel', 'limit': '50', 'offset': '100', 'next_token': 'abc'}) == {
            'keyword': 'hotel',
        }

    def test_drops_every_list_next_token(self) -> None:
        assert export_params({'view': 'brands', 'brands_next_token': 'a', 'sources_next_token': 'b'}) == {
            'view': 'brands',
        }

    def test_keeps_a_param_that_only_contains_next_token(self) -> None:
        assert export_params({'next_token_hint': 'x'}) == {'next_token_hint': 'x'}

    def test_returns_an_empty_dict_for_no_params(self) -> None:
        assert export_params({}) == {}

    def test_returns_a_copy(self) -> None:
        query = {'keyword': 'hotel'}
        export_params(query)['keyword'] = 'changed'
        assert query == {'keyword': 'hotel'}


class TestExportObjectKey:
    def test_places_the_file_under_its_owner_and_export(self) -> None:
        assert export_object_key('sub-1', 'exp-1', 'citations.csv') == 'exports/sub-1/exp-1/citations.csv'

    @pytest.mark.parametrize(
        ('owner', 'export_id', 'filename'),
        [
            ('', 'exp-1', 'a.csv'),
            ('sub-1', '', 'a.csv'),
            ('sub-1', 'exp-1', ''),
            ('sub/1', 'exp-1', 'a.csv'),
            ('sub-1', 'exp\\1', 'a.csv'),
            ('sub-1', 'exp-1', '../a.csv'),
            ('..', 'exp-1', 'a.csv'),
            ('sub-1', 'exp-1', 'a\x00.csv'),
        ],
    )
    def test_rejects_an_empty_or_path_traversing_part(self, owner: str, export_id: str, filename: str) -> None:
        with pytest.raises(ValueError, match='invalid export key'):
            export_object_key(owner, export_id, filename)


class TestCallerFromEvent:
    def test_reads_sub_email_and_groups(self) -> None:
        event = _event({'sub': 'sub-1', 'email': 'ana@example.com', 'cognito:groups': 'Admin,Users'})
        assert caller_from_event(event) == Caller('sub-1', 'ana@example.com', frozenset({'Admin', 'Users'}))

    def test_has_no_email_or_groups_when_the_claims_carry_none(self) -> None:
        assert caller_from_event(_event({'sub': 'sub-1'})) == Caller('sub-1', None, frozenset())

    def test_is_none_without_a_sub(self) -> None:
        assert caller_from_event(_event({'email': 'ana@example.com'})) is None

    def test_is_none_for_a_blank_sub(self) -> None:
        assert caller_from_event(_event({'sub': '  '})) is None

    def test_is_none_for_a_direct_invoke(self) -> None:
        assert caller_from_event({'action': 'chunk'}) is None
