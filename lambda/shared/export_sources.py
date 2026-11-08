"""
The registry of export row sources: one ``ExportRowSource`` per ``EXPORT_VIEWS`` id (2.45.0).

The export worker (``lambda/export-worker``) and ``POST /api/exports`` look a
view up here. The sources live in flat ``export_source_<group>.py`` modules
(the Lambda layer copies only ``lambda/shared/*.py``); most replay the view's
own API route page by page (``shared.export_source_routes``), so an export
holds exactly the rows the view lists, with its filters, all of them.
"""

from __future__ import annotations

from collections.abc import Iterable

from shared.export_contract import EXPORT_VIEWS, ExportRowSource
from shared.export_source_actions import SOURCES_OF_ACTIONS
from shared.export_source_citations import SOURCES_OF_CITATIONS
from shared.export_source_lists import SOURCES_OF_LISTS
from shared.export_source_mentions import SOURCES_OF_MENTIONS
from shared.export_source_reports import SOURCES_OF_REPORTS
from shared.export_source_seo_paid import SOURCES_OF_SEO_PAID
from shared.export_source_seo_stored import SOURCES_OF_SEO_STORED
from shared.export_source_studio import SOURCES_OF_STUDIO
from shared.export_source_trends import SOURCES_OF_TRENDS
from shared.export_source_visibility import SOURCES_OF_VISIBILITY


def _registry(groups: Iterable[Iterable[ExportRowSource]]) -> dict[str, ExportRowSource]:
    registry: dict[str, ExportRowSource] = {}
    for group in groups:
        for source in group:
            if source.view not in EXPORT_VIEWS or source.view in registry:
                raise ValueError(f'export source {source.view!r} is unknown or registered twice')
            registry[source.view] = source
    return registry


#: ``{view id: its row source}``.
EXPORT_SOURCES: dict[str, ExportRowSource] = _registry((
    SOURCES_OF_VISIBILITY, SOURCES_OF_MENTIONS, SOURCES_OF_TRENDS, SOURCES_OF_CITATIONS,
    SOURCES_OF_ACTIONS, SOURCES_OF_REPORTS, SOURCES_OF_STUDIO, SOURCES_OF_LISTS,
    SOURCES_OF_SEO_STORED, SOURCES_OF_SEO_PAID,
))
