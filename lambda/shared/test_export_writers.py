"""The export file pipeline: resumed CSV / XLSX files equal uninterrupted ones, sheets roll over, cells are safe."""

from __future__ import annotations

import pytest

from shared import export_xlsx
from shared.export_contract import ExportRow
from shared.export_jobs import summary
from shared.export_writers import (
    CsvWriter,
    FileOutput,
    checkpoint_blob,
    checkpoint_key,
    csv_cell,
    csv_columns,
    open_writer,
    split_checkpoint_blob,
)
from shared.export_xlsx import sheet_title
from testing.export_fakes import ListRowSource
from testing.export_fixtures import (
    CITATION_SHEET,
    DOMAIN_SHEET,
    ExportHarness,
    citations_source,
    csv_lines,
    two_sheet_source,
    xlsx_entries,
    xlsx_rows,
    xlsx_sheet_names,
)


@pytest.fixture
def small_segments(monkeypatch: pytest.MonkeyPatch) -> None:
    """Segments of 7 rows, so a chunk boundary falls inside and between segments."""
    monkeypatch.setattr(export_xlsx, 'SEGMENT_ROWS', 7)


@pytest.fixture
def rolled_over() -> bytes:
    """Seven rows in worksheets of three: two full worksheets and one with a single row."""
    return ExportHarness(citations_source(7), sheet_rows=3).run('xlsx')


class TestResumedFilesAreByteIdentical:
    @pytest.mark.parametrize('chunks', [2, 5])
    def test_csv_written_in_chunks_equals_the_csv_written_in_one_chunk(self, chunks: int) -> None:
        whole = ExportHarness(citations_source(300)).run('csv')
        resumed = ExportHarness(citations_source(300, per_chunk=300 // chunks))

        assert resumed.run('csv') == whole

    @pytest.mark.parametrize('chunks', [2, 5])
    @pytest.mark.usefixtures('small_segments')
    def test_xlsx_written_in_chunks_equals_the_xlsx_written_in_one_chunk(self, chunks: int) -> None:
        whole = ExportHarness(citations_source(300)).run('xlsx')
        resumed = ExportHarness(citations_source(300, per_chunk=300 // chunks))

        assert resumed.run('xlsx') == whole

    @pytest.mark.parametrize(('per_chunk', 'chunks'), [(None, 1), (150, 2), (60, 5)])
    def test_the_export_runs_in_the_expected_number_of_chunks(self, per_chunk: int | None, chunks: int) -> None:
        harness = ExportHarness(citations_source(300, per_chunk=per_chunk))
        harness.run('xlsx')

        assert harness.chunks_run == chunks

    @pytest.mark.usefixtures('small_segments')
    def test_two_sheet_xlsx_resumed_across_the_sheet_boundary_equals_one_run(self) -> None:
        whole = ExportHarness(two_sheet_source(40, 25)).run('xlsx')
        resumed = ExportHarness(two_sheet_source(40, 25, per_chunk=13))

        assert resumed.run('xlsx') == whole

    def test_a_chunk_resumes_the_source_after_the_last_row_it_wrote(self) -> None:
        harness = ExportHarness(citations_source(10, per_chunk=4))
        harness.run('csv')

        assert harness.source.calls == [None, {'next': 4}, {'next': 8}]


class TestCsvFile:
    def test_starts_with_a_bom_and_the_header_row(self) -> None:
        data = ExportHarness(citations_source(2)).run('csv')

        assert data.startswith(b'\xef\xbb\xbfurl,keyword,citation_count,share\r\n')

    def test_holds_every_row_of_the_source(self) -> None:
        data = ExportHarness(citations_source(300, per_chunk=60)).run('csv')

        assert [line[0] for line in csv_lines(data)[1:]] == [f'https://example.com/page/{index}' for index in range(300)]

    def test_writes_numbers_and_empty_cells_as_values(self) -> None:
        data = ExportHarness(citations_source(2)).run('csv')

        assert csv_lines(data)[1:] == [['https://example.com/page/0', 'hôtel coruña 0', '0', ''], ['https://example.com/page/1', 'hôtel coruña 1', '7', '0.125']]

    def test_prefixes_a_formula_like_text_cell_with_a_quote(self) -> None:
        data = ExportHarness(citations_source(4)).run('csv')

        assert csv_lines(data)[4][1] == '\'=HYPERLINK("x")'

    def test_several_sheets_share_one_file_with_a_sheet_column(self) -> None:
        data = ExportHarness(two_sheet_source(1, 1)).run('csv')

        assert csv_lines(data) == [
            ['sheet', 'url', 'keyword', 'citation_count', 'share', 'domain'],
            ['Citations', 'https://example.com/page/0', 'hôtel coruña 0', '0', '', ''],
            ['Domains', '', '', '0', '', 'site-0.example'],
        ]


class TestXlsxFile:
    def test_is_a_valid_workbook_with_one_sheet_and_its_package_parts(self) -> None:
        data = ExportHarness(citations_source(3)).run('xlsx')

        assert sorted(xlsx_entries(data)) == ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']

    def test_first_row_is_the_header_and_then_every_row(self) -> None:
        data = ExportHarness(citations_source(2)).run('xlsx')

        assert xlsx_rows(data, 1) == [['url', 'keyword', 'citation_count', 'share'], ['https://example.com/page/0', 'hôtel coruña 0', '0'], ['https://example.com/page/1', 'hôtel coruña 1', '7', '0.125']]

    def test_rolls_over_to_a_new_worksheet_after_the_sheet_row_limit(self, rolled_over: bytes) -> None:
        assert xlsx_sheet_names(rolled_over) == ['Citations', 'Citations 2', 'Citations 3']

    def test_a_rolled_over_worksheet_starts_with_the_header_row(self, rolled_over: bytes) -> None:
        assert [row[0] for row in xlsx_rows(rolled_over, 3)] == ['url', 'https://example.com/page/6']

    def test_full_worksheets_hold_exactly_the_sheet_row_limit(self, rolled_over: bytes) -> None:
        assert [len(xlsx_rows(rolled_over, number)) - 1 for number in (1, 2, 3)] == [3, 3, 1]

    def test_resumed_rollover_equals_one_run(self) -> None:
        whole = ExportHarness(citations_source(20), sheet_rows=6).run('xlsx')
        resumed = ExportHarness(citations_source(20, per_chunk=4), sheet_rows=6)

        assert resumed.run('xlsx') == whole

    def test_a_sheet_without_rows_is_written_with_its_header(self) -> None:
        data = ExportHarness(two_sheet_source(2, 0)).run('xlsx')

        assert xlsx_rows(data, 2) == [['domain', 'citation_count']]

    def test_names_every_sheet_of_the_view(self) -> None:
        data = ExportHarness(two_sheet_source(2, 2)).run('xlsx')

        assert xlsx_sheet_names(data) == ['Citations', 'Domains']


class TestWriterRules:
    def test_refuses_a_row_of_an_unknown_sheet(self) -> None:
        writer = CsvWriter((CITATION_SHEET,), FileOutput())

        with pytest.raises(ValueError, match="unknown sheet 'Other'"):
            writer.write_row(ExportRow('Other', ('a',), {}))

    def test_refuses_a_row_with_the_wrong_number_of_values(self) -> None:
        writer = open_writer('xlsx', (CITATION_SHEET,), FileOutput())

        with pytest.raises(ValueError, match='has 1 values for 4 columns'):
            writer.write_row(ExportRow('Citations', ('a',), {}))

    def test_xlsx_refuses_rows_of_an_earlier_sheet_after_a_later_one(self) -> None:
        writer = open_writer('xlsx', (CITATION_SHEET, DOMAIN_SHEET), FileOutput())
        writer.write_row(ExportRow('Domains', ('a', 1), {}))

        with pytest.raises(ValueError, match="sheet 'Citations' came after sheet 'Domains'"):
            writer.write_row(ExportRow('Citations', ('u', 'k', 1, 0.5), {}))

    def test_an_export_needs_a_sheet(self) -> None:
        with pytest.raises(ValueError, match='at least one sheet'):
            open_writer('csv', (), FileOutput())


class TestCells:
    @pytest.mark.parametrize('text', ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx'])
    def test_csv_text_starting_a_formula_gets_a_quote(self, text: str) -> None:
        assert csv_cell(text) == f"'{text}"

    def test_csv_negative_number_is_written_as_a_number(self) -> None:
        assert csv_cell(-3) == '-3'

    def test_csv_booleans_are_words(self) -> None:
        assert (csv_cell(True), csv_cell(False)) == ('true', 'false')

    def test_csv_columns_of_one_sheet_have_no_sheet_column(self) -> None:
        assert csv_columns((DOMAIN_SHEET,)) == ('domain', 'citation_count')

    def test_xlsx_text_keeps_no_xml_control_characters(self) -> None:
        assert export_xlsx.row_xml(2, ('a\x00b<',)) == b'<row r="2"><c r="A2" t="inlineStr"><is><t xml:space="preserve">ab&lt;</t></is></c></row>'

    def test_xlsx_infinite_float_is_text(self) -> None:
        assert export_xlsx.row_xml(2, (float('inf'),)) == b'<row r="2"><c r="A2" t="inlineStr"><is><t xml:space="preserve">inf</t></is></c></row>'

    def test_xlsx_boolean_is_a_boolean_cell(self) -> None:
        assert export_xlsx.row_xml(2, (True,)) == b'<row r="2"><c r="A2" t="b"><v>1</v></c></row>'


def _long_cell_source(per_chunk: int | None = None) -> ListRowSource:
    """Four rows of the citations sheet whose keyword cells hold 40,000 characters in rows 1 and 3."""
    rows = [('Citations', (f'https://example.com/{index}', ('ñ' * 40_000) if index % 2 else 'short', index, None)) for index in range(4)]
    return ListRowSource((CITATION_SHEET,), rows, per_chunk=per_chunk)


@pytest.fixture
def long_xlsx_cell() -> str:
    """The keyword cell of a 40,000-character row as the XLSX export writes it."""
    return xlsx_rows(ExportHarness(_long_cell_source()).run('xlsx'), 1)[2][1]


class TestLongXlsxCells:
    """XLSX cells over Excel's limit say they were cut; the CSV keeps them whole (review F10)."""

    def test_a_cell_over_the_limit_ends_with_the_truncation_marker(self, long_xlsx_cell: str) -> None:
        assert long_xlsx_cell.endswith(export_xlsx.TRUNCATED_MARKER)

    def test_a_cut_cell_holds_exactly_excels_limit_of_characters(self, long_xlsx_cell: str) -> None:
        assert (len(long_xlsx_cell), long_xlsx_cell[:3]) == (export_xlsx.CELL_CHARS, 'ñññ')

    def test_the_export_counts_its_cut_cells_across_chunks(self) -> None:
        harness = ExportHarness(_long_cell_source(per_chunk=1))
        harness.run('xlsx')

        assert summary(next(iter(harness.table.rows.values())))['truncated_cells'] == 2

    def test_the_csv_keeps_the_whole_text_and_counts_no_cut_cell(self) -> None:
        harness = ExportHarness(_long_cell_source())
        data = harness.run('csv')

        assert (len(csv_lines(data)[2][1]), summary(next(iter(harness.table.rows.values())))['truncated_cells']) == (40_000, 0)


class TestSheetTitles:
    def test_drops_characters_excel_refuses(self) -> None:
        assert sheet_title('a/b:c', 1, []) == 'a b c'

    def test_cuts_to_31_characters_with_the_part_number(self) -> None:
        assert sheet_title('x' * 40, 2, []) == 'x' * 29 + ' 2'

    def test_makes_a_taken_title_unique(self) -> None:
        assert sheet_title('Sheet', 1, ['sheet']) == 'Sheet (2)'


class TestCheckpointBlob:
    def test_splits_into_the_buffer_and_pending_bytes_it_packed(self) -> None:
        assert split_checkpoint_blob(checkpoint_blob(b'abc', b'<row/>')) == (b'abc', b'<row/>')

    def test_refuses_a_truncated_blob(self) -> None:
        with pytest.raises(ValueError, match='truncated'):
            split_checkpoint_blob(checkpoint_blob(b'abcdef', b'')[:10])

    def test_checkpoint_key_sits_next_to_the_file(self) -> None:
        assert checkpoint_key('exports/sub/exp-1/file.csv', 3) == 'exports/sub/exp-1/checkpoint-000003'

