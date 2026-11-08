"""Export service fixtures (2.45.0): callers, sheets and rows, and a driver that runs a job through the state machine's steps."""

from __future__ import annotations

import csv
import io
import os
import re
import zipfile
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from shared.export_contract import Caller, ExportFormat, ExportRowSource, ExportSheet
from shared.export_jobs import ExportJobs, NewExport, new_item
from shared.export_steps import ExportDeps, chunk, finalize, prepare
from testing.clocks import JumpClock
from testing.export_fakes import ConditionalTable, ListRowSource, MultipartS3, exports_table
from testing.handler_fixtures import handler_fixture

BUCKET = 'citation-analysis-keywords-123456789012'
#: The environment of the exports API and the export worker.
EXPORTS_ENV = {
    'DYNAMODB_TABLE_EXPORTS': 'CitationAnalysis-Exports', 'EXPORTS_BUCKET': BUCKET,
    'EXPORT_STATE_MACHINE_ARN': 'arn:aws:states:us-east-1:123456789012:stateMachine:CitationAnalysis-Export',
}
NOW = datetime(2026, 11, 6, 9, 30, 0, tzinfo=UTC)
ALICE = Caller(sub='sub-alice', email='alice@example.com', groups=frozenset({'Users'}))
BOB = Caller(sub='sub-bob', email='bob@example.com', groups=frozenset({'Users'}))
#: Seconds of every chunk the harness runs.
CHUNK_SECONDS = 600
#: Small parts, so a few hundred rows span several of them.
TEST_PART_BYTES = 1024

CITATION_SHEET = ExportSheet('Citations', ('url', 'keyword', 'citation_count', 'share'))
DOMAIN_SHEET = ExportSheet('Domains', ('domain', 'citation_count'))


def citation_rows(count: int) -> list[tuple[str, tuple[Any, ...]]]:
    """``count`` rows of the citations sheet, text with accents, a formula-like cell and empty cells."""
    rows: list[tuple[str, tuple[Any, ...]]] = []
    for index in range(count):
        keyword = '=HYPERLINK("x")' if index == 3 else f'hôtel coruña {index}'
        rows.append(('Citations', (f'https://example.com/page/{index}', keyword, index * 7, None if index % 5 == 0 else index / 8)))
    return rows


def domain_rows(count: int) -> list[tuple[str, tuple[Any, ...]]]:
    return [('Domains', (f'site-{index}.example', index)) for index in range(count)]


def citations_source(count: int, per_chunk: int | None = None, *, spends_deadline: bool = True) -> ListRowSource:
    return ListRowSource((CITATION_SHEET,), citation_rows(count), per_chunk=per_chunk, spends_deadline=spends_deadline)


def two_sheet_source(citations: int, domains: int, per_chunk: int | None = None) -> ListRowSource:
    return ListRowSource((CITATION_SHEET, DOMAIN_SHEET), [*citation_rows(citations), *domain_rows(domains)], per_chunk=per_chunk)


@dataclass
class ExportHarness[Source: ExportRowSource]:
    """A jobs table, a bucket and the step dependencies over one row source.

    Each chunk's deadline runs on ``clock`` (a ``ListRowSource``'s own clock
    unless one is given), reset to 0 before every chunk.
    """

    source: Source
    clock: JumpClock | None = None
    groups_of: Callable[[str], frozenset[str]] | None = None
    sheet_rows: int = 1_048_575
    table: ConditionalTable = field(default_factory=exports_table)
    s3: MultipartS3 = field(default_factory=lambda: MultipartS3(min_part_bytes=TEST_PART_BYTES))
    chunks_run: int = 0

    @property
    def deps(self) -> ExportDeps:
        return ExportDeps(
            jobs=ExportJobs(self.table), s3=self.s3, bucket=BUCKET, sources={self.source.view: self.source},
            now=lambda: NOW, groups_of=self.groups_of, part_bytes=TEST_PART_BYTES, sheet_rows=self.sheet_rows,
        )

    def queue(self, export_format: ExportFormat, caller: Caller = ALICE, params: dict[str, str] | None = None) -> str:
        """A queued export of the source's view; its id."""
        item = new_item(NewExport(caller, self.source.view, params or {}, export_format), NOW)
        self.deps.jobs.create(item)
        return str(item['export_id'])

    def item(self, export_id: str) -> dict[str, Any]:
        found = self.deps.jobs.get(export_id)
        assert found is not None
        return found

    def set_status(self, export_id: str, status: str) -> None:
        self.deps.jobs.save(self.item(export_id), NOW, status=status)

    def chunk_clock(self) -> JumpClock:
        """The clock chunk deadlines run on."""
        if self.clock is None:
            self.clock = self.source.clock if isinstance(self.source, ListRowSource) else JumpClock()
        return self.clock

    def run_chunk(self, export_id: str) -> bool:
        """One ExportChunk with a fresh deadline of ``CHUNK_SECONDS`` on ``chunk_clock()``; whether the export is done."""
        clock = self.chunk_clock()
        clock.now = 0.0
        self.chunks_run += 1
        return bool(chunk(self.deps, export_id, clock.deadline(CHUNK_SECONDS))['done'])

    def start(self, export_format: ExportFormat = 'csv', caller: Caller = ALICE) -> str:
        """A queued export that ran Prepare; its id."""
        export_id = self.queue(export_format, caller)
        prepare(self.deps, export_id)
        return export_id

    def write_all(self, export_id: str, max_chunks: int = 1_000) -> None:
        """ExportChunk until the export is done."""
        for _ in range(max_chunks):
            if self.run_chunk(export_id):
                return
        raise AssertionError(f'export {export_id} not done after {max_chunks} chunks')

    def run(self, export_format: ExportFormat, caller: Caller = ALICE) -> bytes:
        """Queue an export and run Prepare, ExportChunk until done, Finalize; the file's bytes."""
        export_id = self.start(export_format, caller)
        self.write_all(export_id)
        finalize(self.deps, export_id)
        return self.s3.body(self.file_key(export_id))

    def file_key(self, export_id: str) -> str:
        item = self.item(export_id)
        return f'exports/{item["owner"]}/{export_id}/{item["filename"]}'


def export_handler_fixture(test_file: str, filename: str, module_name: str) -> Any:
    """``handler_fixture`` of ``filename`` next to ``test_file`` with ``EXPORTS_ENV``."""
    return handler_fixture(os.path.dirname(os.path.abspath(test_file)), filename, module_name, env=EXPORTS_ENV)


def csv_lines(data: bytes) -> list[list[str]]:
    """The CSV rows of an export file (its BOM removed)."""
    return list(csv.reader(io.StringIO(data.decode('utf-8-sig'), newline='')))


def xlsx_sheet_names(data: bytes) -> list[str]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        workbook = archive.read('xl/workbook.xml').decode()
    return re.findall(r'<sheet name="([^"]*)"', workbook)


def xlsx_rows(data: bytes, sheet_number: int) -> list[list[str]]:
    """The cell texts / values of worksheet ``sheet_number`` (1-based), row by row (empty cells left out)."""
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        xml = archive.read(f'xl/worksheets/sheet{sheet_number}.xml').decode()
    return [re.findall(r'<(?:t xml:space="preserve"|v)>([^<]*)<', row) for row in re.findall(r'<row r="\d+">(.*?)</row>', xml)]


def xlsx_entries(data: bytes) -> Sequence[str]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        assert archive.testzip() is None
        return archive.namelist()
