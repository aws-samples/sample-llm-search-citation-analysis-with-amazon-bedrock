"""
A streaming XLSX writer whose state survives a Lambda invocation (2.45.0 export service).

An export runs in chunks, each a separate invocation of the export worker, so
the writer cannot keep a ``zipfile.ZipFile`` or a ``zlib`` compressor open
from one chunk to the next. It writes the ZIP container by hand instead:

- every worksheet is one deflated entry with a data descriptor (CRC and sizes
  after the data, so nothing already uploaded is rewritten);
- rows are compressed in *segments* of ``SEGMENT_ROWS`` rows (or
  ``SEGMENT_BYTES`` of XML), each by a fresh raw-deflate compressor ended
  with a full flush, which empties the compressor: its whole state is then
  the running CRC-32 and two byte counts, all plain integers;
- the XML of the rows since the last segment (``pending``) is the only
  thing a checkpoint stores besides those integers.

Segments are cut by row count and size, never by where a chunk stopped, so
a file written in N chunks is byte-identical to one written in one go.

A worksheet holds ``sheet_rows`` data rows (``XLSX_SHEET_ROWS``: Excel's
limit) and at most ``ENTRY_BYTES`` of XML, so no entry needs ZIP64; the
next rows go to ``<name> 2``, ``<name> 3`` ... The central directory uses
ZIP64 records only when the file passes 4 GiB or 65,535 entries.
Strings are inline (no shared-strings table to keep across chunks). A text
longer than Excel's cell limit is cut and ends with ``TRUNCATED_MARKER``;
the writer counts those cells (``truncated_cells``).
"""

from __future__ import annotations

import math
import struct
import zlib
from collections.abc import Sequence
from typing import Any, Final, Protocol
from xml.sax.saxutils import escape

from shared.export_contract import XLSX_SHEET_ROWS, ExportRow, ExportSheet, JsonScalar

#: Rows compressed together; a checkpoint keeps at most this many rows of uncompressed XML.
SEGMENT_ROWS: Final = 2_000
#: XML bytes that close a segment early (rows with long cells).
SEGMENT_BYTES: Final = 4 * 1024 * 1024
#: XML bytes one worksheet entry holds at most: below ZIP's 4 GiB entry limit without ZIP64.
ENTRY_BYTES: Final = 3_500_000_000
#: Excel's limit on the characters of one cell.
CELL_CHARS: Final = 32_767
#: The end of a text cell cut to ``CELL_CHARS`` (the export also counts it in ``truncated_cells``).
TRUNCATED_MARKER: Final = '… [truncated in XLSX — the CSV export has the full text]'

_ZIP32_MAX: Final = 0xFFFFFFFF
_ZIP16_MAX: Final = 0xFFFF
# 1980-01-01 00:00: a fixed timestamp, so the same rows always give the same bytes.
_DOS_TIME, _DOS_DATE = 0, 0x21
_DESCRIPTOR_FLAG: Final = 0x0008
_DEFLATED: Final = 8

# Characters XML 1.0 does not allow in text (answers can carry control characters).
XML_ILLEGAL = dict.fromkeys((*range(0x09), 0x0B, 0x0C, *range(0x0E, 0x20), 0xFFFE, 0xFFFF))
# Characters Excel refuses in a sheet name.
_SHEET_NAME_ILLEGAL = dict.fromkeys(map(ord, '[]:*?/\\'), ' ')
_SHEET_NAME_CHARS: Final = 31

_MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
_PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
_XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
_SHEET_HEAD = f'{_XML_DECL}<worksheet xmlns="{_MAIN_NS}"><sheetData>'.encode()
_SHEET_TAIL = b'</sheetData></worksheet>'


class ByteSink(Protocol):
    """Where the file's bytes go (``shared.export_writers.FileOutput``)."""

    @property
    def total(self) -> int:
        """Bytes written to the file so far."""
        raise NotImplementedError

    def write(self, data: bytes) -> None:
        """Append ``data`` to the file."""


def column_name(index: int) -> str:
    name = ''
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def _is_number(value: JsonScalar) -> bool:
    return isinstance(value, int) or (isinstance(value, float) and math.isfinite(value))


def _text(value: JsonScalar) -> str:
    return str(value).translate(XML_ILLEGAL)


def cut_cells(values: Sequence[JsonScalar]) -> int:
    """How many of ``values`` are text cells longer than Excel's ``CELL_CHARS`` (written cut, with ``TRUNCATED_MARKER``)."""
    return sum(1 for value in values if value is not None and not isinstance(value, bool) and not _is_number(value) and len(_text(value)) > CELL_CHARS)


def _cell(reference: str, value: JsonScalar) -> str:
    if value is None:
        return ''
    if isinstance(value, bool):
        return f'<c r="{reference}" t="b"><v>{int(value)}</v></c>'
    if _is_number(value):
        return f'<c r="{reference}"><v>{value!r}</v></c>'
    text = _text(value)
    if len(text) > CELL_CHARS:
        text = text[:CELL_CHARS - len(TRUNCATED_MARKER)] + TRUNCATED_MARKER
    return f'<c r="{reference}" t="inlineStr"><is><t xml:space="preserve">{escape(text)}</t></is></c>'


def row_xml(number: int, values: Sequence[JsonScalar]) -> bytes:
    """Row ``number`` (1-based) of a worksheet."""
    cells = ''.join(_cell(f'{column_name(index)}{number}', value) for index, value in enumerate(values))
    return f'<row r="{number}">{cells}</row>'.encode()


def sheet_title(name: str, part: int, taken: Sequence[str]) -> str:
    """The workbook name of worksheet ``part`` (1-based) of sheet ``name``: legal, at most 31 characters, unique."""
    base = name.translate(_SHEET_NAME_ILLEGAL).strip().strip("'") or 'Sheet'
    suffix = '' if part == 1 else f' {part}'
    title = base[:_SHEET_NAME_CHARS - len(suffix)] + suffix
    counter = 1
    while title.lower() in {existing.lower() for existing in taken}:
        counter += 1
        tag = f'{suffix} ({counter})'
        title = base[:_SHEET_NAME_CHARS - len(tag)] + tag
    return title


def _local_header(name: bytes) -> bytes:
    return struct.pack('<IHHHHHIIIHH', 0x04034B50, 20, _DESCRIPTOR_FLAG, _DEFLATED, _DOS_TIME, _DOS_DATE, 0, 0, 0, len(name), 0) + name


def _central_entry(entry: dict[str, Any]) -> bytes:
    name = str(entry['name']).encode()
    offset = int(entry['offset'])
    extra = b''
    if offset > _ZIP32_MAX:
        extra = struct.pack('<HHQ', 0x0001, 8, offset)
        offset = _ZIP32_MAX
    return struct.pack(
        '<IHHHHHHIIIHHHHHII', 0x02014B50, 45 if extra else 20, 45 if extra else 20, _DESCRIPTOR_FLAG, _DEFLATED,
        _DOS_TIME, _DOS_DATE, int(entry['crc']), int(entry['csize']), int(entry['usize']), len(name), len(extra), 0, 0, 0, 0, offset,
    ) + name + extra


def _end_records(count: int, directory_size: int, directory_offset: int) -> bytes:
    if count <= _ZIP16_MAX and directory_offset + directory_size <= _ZIP32_MAX:
        return struct.pack('<IHHHHIIH', 0x06054B50, 0, 0, count, count, directory_size, directory_offset, 0)
    zip64_offset = directory_offset + directory_size
    zip64_end = struct.pack('<IQHHIIQQQQ', 0x06064B50, 44, 45, 45, 0, 0, count, count, directory_size, directory_offset)
    locator = struct.pack('<IIQI', 0x07064B50, 0, zip64_offset, 1)
    end = struct.pack('<IHHHHIIH', 0x06054B50, 0, 0, _ZIP16_MAX, _ZIP16_MAX, _ZIP32_MAX, _ZIP32_MAX, 0)
    return zip64_end + locator + end


class XlsxWriter:
    """
    Writes ``sheets`` as one XLSX into ``sink``, rows grouped by sheet in ``sheets`` order.

    ``state`` and ``pending`` (from ``checkpoint()``) resume a file another
    invocation started; without them the writer starts a new file.
    """

    def __init__(
        self, sheets: Sequence[ExportSheet], sink: ByteSink, state: dict[str, Any] | None = None, pending: bytes = b'',
        sheet_rows: int = XLSX_SHEET_ROWS,
    ) -> None:
        self._sheets = tuple(sheets)
        self._index = {sheet.name: position for position, sheet in enumerate(self._sheets)}
        self._sink = sink
        self._sheet_rows = sheet_rows
        self._pending = bytearray(pending)
        self._state: dict[str, Any] = dict(state) if state is not None else {
            'entries': [], 'titles': [], 'current': None, 'sheet': 0, 'part': 0, 'rows_in_part': 0, 'segment_rows': 0, 'rows': 0,
        }

    @property
    def rows(self) -> int:
        """Data rows written so far."""
        return int(self._state['rows'])

    @property
    def truncated_cells(self) -> int:
        """Text cells written cut to ``CELL_CHARS`` so far."""
        return int(self._state.get('truncated_cells', 0))

    def checkpoint(self) -> tuple[dict[str, Any], bytes]:
        """The JSON-serializable state and the uncompressed XML a later writer resumes from."""
        return dict(self._state), bytes(self._pending)

    def write_row(self, row: ExportRow) -> None:
        """Append ``row`` to its sheet (a new worksheet when the current one is full)."""
        position = self._index.get(row.sheet)
        if position is None:
            raise ValueError(f'row of unknown sheet {row.sheet!r}')
        columns = self._sheets[position].columns
        if len(row.values) != len(columns):
            raise ValueError(f'row of sheet {row.sheet!r} has {len(row.values)} values for {len(columns)} columns')
        self._advance_to(position)
        line = row_xml(self._state['rows_in_part'] + 2, row.values)
        if self._state['rows_in_part'] >= self._sheet_rows or self._entry_full(len(line)):
            self._open_part(position, self._state['part'] + 1)
            line = row_xml(2, row.values)
        self._pending += line
        cut = cut_cells(row.values)
        if cut:
            self._state['truncated_cells'] = self.truncated_cells + cut
        self._state['rows_in_part'] += 1
        self._state['rows'] += 1
        self._state['segment_rows'] += 1
        if self._state['segment_rows'] >= SEGMENT_ROWS or len(self._pending) >= SEGMENT_BYTES:
            self._flush_segment(final=False)

    def close(self) -> None:
        """Finish the last worksheet, write the sheets no row reached, the workbook parts and the central directory."""
        self._advance_to(len(self._sheets) - 1)
        self._close_entry()
        titles: list[str] = self._state['titles']
        for name, content in self._package_parts(titles):
            self._open_entry(name)
            self._pending += content
            self._close_entry()
        entries: list[dict[str, Any]] = self._state['entries']
        directory_offset = self._sink.total
        directory = b''.join(_central_entry(entry) for entry in entries)
        self._sink.write(directory + _end_records(len(entries), len(directory), directory_offset))

    # -- worksheets ---------------------------------------------------------

    def _advance_to(self, position: int) -> None:
        current = self._state['sheet'] if self._state['part'] else -1
        if position < current:
            raise ValueError(f'rows of sheet {self._sheets[position].name!r} came after sheet {self._sheets[current].name!r}')
        for skipped in range(current + 1, position + 1):
            self._open_part(skipped, 1)

    def _entry_full(self, extra: int) -> bool:
        current = self._state['current']
        return int(current['usize']) + len(self._pending) + extra + len(_SHEET_TAIL) > ENTRY_BYTES

    def _open_part(self, position: int, part: int) -> None:
        if self._state['current'] is not None:
            self._close_entry()
        titles: list[str] = self._state['titles']
        titles.append(sheet_title(self._sheets[position].name, part, titles))
        self._open_entry(f'xl/worksheets/sheet{len(titles)}.xml')
        self._state.update(sheet=position, part=part, rows_in_part=0)
        self._pending += _SHEET_HEAD + row_xml(1, self._sheets[position].columns)

    # -- ZIP entries --------------------------------------------------------

    def _open_entry(self, name: str) -> None:
        self._state['current'] = {'name': name, 'offset': self._sink.total, 'crc': 0, 'csize': 0, 'usize': 0}
        self._sink.write(_local_header(name.encode()))

    def _flush_segment(self, *, final: bool) -> None:
        current = self._state['current']
        data = bytes(self._pending)
        compressor = zlib.compressobj(6, zlib.DEFLATED, -15)
        compressed = compressor.compress(data) + compressor.flush(zlib.Z_FINISH if final else zlib.Z_FULL_FLUSH)
        current['crc'] = zlib.crc32(data, int(current['crc']))
        current['usize'] = int(current['usize']) + len(data)
        current['csize'] = int(current['csize']) + len(compressed)
        self._sink.write(compressed)
        self._pending.clear()
        self._state['segment_rows'] = 0

    def _close_entry(self) -> None:
        current = self._state['current']
        if str(current['name']).startswith('xl/worksheets/'):
            self._pending += _SHEET_TAIL
        self._flush_segment(final=True)
        self._sink.write(struct.pack('<IIII', 0x08074B50, int(current['crc']), int(current['csize']), int(current['usize'])))
        self._state['entries'].append(current)
        self._state['current'] = None

    @staticmethod
    def _package_parts(titles: Sequence[str]) -> list[tuple[str, bytes]]:
        numbers = range(1, len(titles) + 1)
        sheet_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
        overrides = ''.join(f'<Override PartName="/xl/worksheets/sheet{n}.xml" ContentType="{sheet_type}"/>' for n in numbers)
        content_types = (
            f'{_XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            f'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            f'{overrides}</Types>'
        )
        root_rels = (
            f'{_XML_DECL}<Relationships xmlns="{_PKG_REL_NS}">'
            f'<Relationship Id="rId1" Type="{_REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>'
        )
        sheets = ''.join(f'<sheet name="{escape(title, {chr(34): "&quot;"})}" sheetId="{n}" r:id="rId{n}"/>' for n, title in zip(numbers, titles, strict=True))
        workbook = f'{_XML_DECL}<workbook xmlns="{_MAIN_NS}" xmlns:r="{_REL_NS}"><sheets>{sheets}</sheets></workbook>'
        relations = ''.join(f'<Relationship Id="rId{n}" Type="{_REL_NS}/worksheet" Target="worksheets/sheet{n}.xml"/>' for n in numbers)
        workbook_rels = f'{_XML_DECL}<Relationships xmlns="{_PKG_REL_NS}">{relations}</Relationships>'
        return [
            ('[Content_Types].xml', content_types.encode()),
            ('_rels/.rels', root_rels.encode()),
            ('xl/workbook.xml', workbook.encode()),
            ('xl/_rels/workbook.xml.rels', workbook_rels.encode()),
        ]
