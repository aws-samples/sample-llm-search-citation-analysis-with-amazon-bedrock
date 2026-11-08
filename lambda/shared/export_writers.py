"""
The export file pipeline (2.45.0): resumable CSV / XLSX writers and the S3 multipart upload they feed.

An export runs as a loop of worker invocations (``CitationAnalysis-Export``),
each writing rows until its deadline. Between two invocations nothing stays
in memory, so everything a writer holds is checkpointed:

- ``FileOutput`` collects the file's bytes; ``PartUpload.send_full_parts``
  uploads every whole ``PART_BYTES`` part of it, the rest (less than a part)
  stays in the buffer;
- ``checkpoint_blob`` packs that rest and the writer's uncompressed pending
  XML into one small S3 object (``checkpoint_key``), and the writer's state
  (counters, ZIP entries) into a JSON dict for the job item;
- ``open_writer`` with that state and blob continues the same file.

Part boundaries are fixed multiples of ``PART_BYTES`` of the file, and the
writers' output never depends on where a chunk stopped, so the object is
byte-identical however many chunks wrote it.

CSV: UTF-8 with a BOM (Excel then reads accents), CRLF lines, a header row;
a view with several sheets is one file with a leading ``sheet`` column and
the union of the sheets' columns. A text cell starting with ``= + - @``,
tab or CR gets a leading ``'`` so no spreadsheet runs it as a formula.

Security (builder-security): objects are written under
``exports/<owner>/<export_id>/`` of the private keywords bucket (Block Public
Access, no ACL, 7-day lifecycle); only the API hands out presigned GETs.
"""

from __future__ import annotations

import csv
import io
import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Final, Protocol

from shared.export_contract import (
    MULTIPART_MIN_PART_BYTES,
    XLSX_SHEET_ROWS,
    ExportFormat,
    ExportRow,
    ExportSheet,
    JsonScalar,
)
from shared.export_xlsx import XlsxWriter

#: Bytes of every multipart part but the last (S3 needs at least 5 MiB; 16 MiB keeps 10,000 parts at 160 GB).
PART_BYTES: Final = max(16 * 1024 * 1024, MULTIPART_MIN_PART_BYTES)

CONTENT_TYPES: Final[dict[str, str]] = {
    'csv': 'text/csv; charset=utf-8',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

_FORMULA_PREFIXES = ('=', '+', '-', '@', '\t', '\r')
_BOM: Final = '\ufeff'.encode()
_BLOB_HEADER_BYTES: Final = 8


@dataclass
class FileOutput:
    """The bytes of a file not uploaded yet; ``total`` counts every byte written, uploaded or not."""

    buffer: bytearray = field(default_factory=bytearray)
    total: int = 0

    def write(self, data: bytes) -> None:
        self.buffer += data
        self.total += len(data)


class FileWriter(Protocol):
    """A resumable writer of one export format."""

    @property
    def rows(self) -> int:
        """Data rows written so far."""
        raise NotImplementedError

    @property
    def truncated_cells(self) -> int:
        """Cells the format could not hold whole (XLSX text over Excel's limit; CSV: none)."""
        raise NotImplementedError

    def write_row(self, row: ExportRow) -> None:
        """Append one data row."""

    def close(self) -> None:
        """Write what the format needs after the last row."""

    def checkpoint(self) -> tuple[dict[str, Any], bytes]:
        """The writer's JSON state and its pending (not yet written) bytes."""
        raise NotImplementedError


def csv_cell(value: JsonScalar) -> str:
    """``value`` as a CSV cell; text a spreadsheet would read as a formula is prefixed with ``'``."""
    if value is None:
        return ''
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, (int, float)):
        return repr(value)
    return f"'{value}" if value.startswith(_FORMULA_PREFIXES) else value


def csv_columns(sheets: Sequence[ExportSheet]) -> tuple[str, ...]:
    """The CSV header: the sheet's columns, or ``sheet`` and the union of every sheet's columns."""
    if len(sheets) == 1:
        return sheets[0].columns
    return ('sheet', *dict.fromkeys(column for sheet in sheets for column in sheet.columns))


class CsvWriter:
    """CSV rows into ``output``; ``state`` resumes a file another invocation started."""

    def __init__(self, sheets: Sequence[ExportSheet], output: FileOutput, state: dict[str, Any] | None = None) -> None:
        self._columns = csv_columns(sheets)
        multi = len(sheets) > 1
        self._layouts = {
            sheet.name: (multi, tuple(self._columns.index(column) for column in sheet.columns)) for sheet in sheets
        }
        self._output = output
        self._rows = int((state or {}).get('rows', 0))
        if state is None:
            output.write(_BOM)
            self._line(self._columns)

    @property
    def rows(self) -> int:
        return self._rows

    @property
    def truncated_cells(self) -> int:
        return 0

    def _line(self, cells: Sequence[str]) -> None:
        buffer = io.StringIO()
        csv.writer(buffer, lineterminator='\r\n').writerow(cells)
        self._output.write(buffer.getvalue().encode('utf-8'))

    def write_row(self, row: ExportRow) -> None:
        layout = self._layouts.get(row.sheet)
        if layout is None:
            raise ValueError(f'row of unknown sheet {row.sheet!r}')
        multi, positions = layout
        if len(row.values) != len(positions):
            raise ValueError(f'row of sheet {row.sheet!r} has {len(row.values)} values for {len(positions)} columns')
        cells = [''] * len(self._columns)
        if multi:
            cells[0] = csv_cell(row.sheet)
        for position, value in zip(positions, row.values, strict=True):
            cells[position] = csv_cell(value)
        self._line(cells)
        self._rows += 1

    def close(self) -> None:
        """A CSV has no trailer."""

    def checkpoint(self) -> tuple[dict[str, Any], bytes]:
        return {'rows': self._rows}, b''


def open_writer(
    export_format: ExportFormat, sheets: Sequence[ExportSheet], output: FileOutput,
    state: dict[str, Any] | None = None, pending: bytes = b'', sheet_rows: int = XLSX_SHEET_ROWS,
) -> FileWriter:
    """The writer of ``export_format``: a new file, or the one ``state`` / ``pending`` checkpointed."""
    if not sheets:
        raise ValueError('an export needs at least one sheet')
    if export_format == 'csv':
        return CsvWriter(sheets, output, state)
    return XlsxWriter(sheets, output, state, pending, sheet_rows)


# ---------------------------------------------------------------------------
# Checkpoints
# ---------------------------------------------------------------------------

def checkpoint_key(file_key: str, sequence: int) -> str:
    """The checkpoint object chunk ``sequence`` writes next to ``file_key`` (a new key per chunk, so a retried chunk re-reads its input)."""
    return f'{file_key.rsplit("/", 1)[0]}/checkpoint-{sequence:06d}'


def checkpoint_blob(buffer: bytes, pending: bytes) -> bytes:
    """``buffer`` (file bytes not uploaded) and ``pending`` (writer bytes not written) as one object."""
    return len(buffer).to_bytes(_BLOB_HEADER_BYTES, 'big') + buffer + pending


def split_checkpoint_blob(blob: bytes) -> tuple[bytes, bytes]:
    """The ``(buffer, pending)`` that ``checkpoint_blob`` packed."""
    size = int.from_bytes(blob[:_BLOB_HEADER_BYTES], 'big')
    body = blob[_BLOB_HEADER_BYTES:]
    if size > len(body):
        raise ValueError('truncated export checkpoint')
    return body[:size], body[size:]


def writer_state_json(state: dict[str, Any]) -> str:
    """The writer state as stored in the job item (a string: DynamoDB would turn its integers into Decimals)."""
    return json.dumps(state, separators=(',', ':'), sort_keys=True)


# ---------------------------------------------------------------------------
# S3 multipart upload
# ---------------------------------------------------------------------------

@dataclass
class PartUpload:
    """One multipart upload: the ETags of the parts sent so far, in order (part N is ``etags[N-1]``)."""

    s3: Any
    bucket: str
    key: str
    upload_id: str
    etags: list[str] = field(default_factory=list)
    part_bytes: int = PART_BYTES

    @classmethod
    def create(cls, s3: Any, bucket: str, key: str, export_format: ExportFormat, filename: str) -> PartUpload:
        """Start the upload of ``key``; the object downloads as an attachment named ``filename``."""
        created = s3.create_multipart_upload(
            Bucket=bucket, Key=key, ContentType=CONTENT_TYPES[export_format],
            ContentDisposition=f'attachment; filename="{filename}"',
        )
        return cls(s3, bucket, key, str(created['UploadId']))

    def _send(self, body: bytes) -> None:
        number = len(self.etags) + 1
        response = self.s3.upload_part(Bucket=self.bucket, Key=self.key, UploadId=self.upload_id, PartNumber=number, Body=body)
        self.etags.append(str(response['ETag']))

    def send_full_parts(self, output: FileOutput) -> None:
        """Upload every whole part ``output`` holds; less than a part stays in its buffer."""
        while len(output.buffer) >= self.part_bytes:
            self._send(bytes(output.buffer[:self.part_bytes]))
            del output.buffer[:self.part_bytes]

    def send_rest(self, output: FileOutput) -> None:
        """Upload the whole parts and then the last, shorter one (the file is complete)."""
        self.send_full_parts(output)
        if output.buffer or not self.etags:
            self._send(bytes(output.buffer))
            output.buffer.clear()

    def complete(self) -> None:
        parts = [{'ETag': etag, 'PartNumber': number} for number, etag in enumerate(self.etags, start=1)]
        self.s3.complete_multipart_upload(Bucket=self.bucket, Key=self.key, UploadId=self.upload_id, MultipartUpload={'Parts': parts})
