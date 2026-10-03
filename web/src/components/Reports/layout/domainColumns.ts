import type { SourceRow } from '../../../types';
import { formatKpi } from '../../../formatting/kpiFormatter';
import { engineName } from '../charts/engineKpiChartConfiguration';
import type { ReportTableColumn } from './ReportTable';

/** What each figure of a cited domain counts, in its column tooltip. */
export interface DomainColumnInfo {
  readonly citations: string;
  readonly citationRate: string;
  readonly citationShare: string;
  readonly engines: string;
  readonly keywords: string;
}

/** The figures of a cited domain, after its name: citations, rate, share, engines and keywords. */
export function domainFigureColumns(info: DomainColumnInfo): ReadonlyArray<ReportTableColumn<SourceRow>> {
  return [
    {
      header: 'Citations',
      info: info.citations,
      render: (source) => source.citations,
    },
    {
      header: 'Citation rate',
      info: info.citationRate,
      render: (source) => formatKpi('citation_rate', source.citation_rate),
    },
    {
      header: 'Citation share',
      info: info.citationShare,
      render: (source) => formatKpi('citation_share', source.citation_share),
    },
    {
      header: 'Engines',
      info: info.engines,
      render: (source) => source.engines.map(engineName).join(', '),
    },
    {
      header: 'Keywords',
      info: info.keywords,
      render: (source) => source.keywords,
    },
  ];
}
