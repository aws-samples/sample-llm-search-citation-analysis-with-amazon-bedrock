/**
 * Local rank grid: where a business ranks on Google Maps at every point of a 3×3, 5×5 or 7×7 grid around a
 * centre. One queued Maps search per point, started only after the user confirms the call count; re-running the
 * same grid within the hour collects the searches already bought instead of buying them again. The keyword field
 * suggests the header market's Settings keywords; the business left empty is matched by the brand's own domain.
 */
import { useState } from 'react';
import { useLocalSeoJob } from '../../../hooks/useLocalSeoJob';
import type {
  GridJobRequest, GridPoint, GridResult, GridSize
} from '../../../types/api/seoLocal';
import { ConfirmModal } from '../../ui/Modal';
import {
  IdentityFields, PointFields, SelectField, TextField
} from './LocalSeoFields';
import {
  LocalCard, LocalExcelButton, LocalForm
} from './LocalSeoLayout';
import {
  localScopeLabel, rankGridExport
} from './localSeoExcel';
import {
  EMPTY_POINT, hasSearchPoint, pointFields, rankBand, targetFields, type IdentityInput
} from './localSeoRequest';
import {
  TARGET_LABEL, TargetTabHints, marketHasPoint, targetPlaceholder, type LocalTabProps
} from './localSeoSettings';
import { JobProgress } from './ProfileActivity';

const SIZES = [
  {
    value: '3',
    label: '3 × 3 (9 points)' 
  },
  {
    value: '5',
    label: '5 × 5 (25 points)' 
  },
  {
    value: '7',
    label: '7 × 7 (49 points)' 
  },
] satisfies {
  value: string;
  label: string 
}[];

const BAND_CLASSES: Record<ReturnType<typeof rankBand>, string> = {
  top3: 'bg-emerald-700 text-white',
  top10: 'bg-gray-300 text-amber-950',
  low: 'bg-red-600 text-white',
  missing: 'bg-gray-200 text-gray-600',
};

function cellText(point: GridPoint): string {
  if (point.status === 'pending') return '…';
  if (point.status === 'failed') return '×';
  return point.rank === null ? '–' : String(point.rank);
}

function cellLabel(point: GridPoint): string {
  const where = `Row ${String(point.row + 1)}, column ${String(point.col + 1)}`;
  if (point.status !== 'ready') return `${where}: ${point.status}`;
  return point.rank === null ? `${where}: not in the top 20` : `${where}: rank ${String(point.rank)}`;
}

function GridMap({ result }: { readonly result: GridResult }) {
  const size = Math.round(Math.sqrt(result.points.length));
  const rows = Array.from({ length: size }, (_, row) => result.points.slice(row * size, (row + 1) * size));
  return (
    <table className="border-separate border-spacing-1" aria-label="Rank grid, north at the top">
      <tbody>
        {rows.map((cells) => (
          <tr key={cells[0]?.index ?? 0}>
            {cells.map((point) => (
              <td
                key={point.index}
                aria-label={cellLabel(point)}
                title={point.top_result?.title ? `Top result: ${point.top_result.title}` : undefined}
                className={`h-12 w-12 rounded text-center text-sm font-semibold ${
                  point.status === 'ready' ? BAND_CLASSES[rankBand(point.rank)] : BAND_CLASSES.missing
                }`}
              >
                {cellText(point)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GridSummaryLine({ result }: { readonly result: GridResult }) {
  const { summary } = result;
  return (
    <p className="text-sm text-gray-700">
      Found at {summary.points_found} of {summary.points_searched} points
      {summary.average_rank === null ? '' : ` · average rank ${String(summary.average_rank)}`}
      {` · top 3 at ${String(summary.top3_count)} · top 10 at ${String(summary.top10_count)}`}
      {summary.points_failed > 0 ? ` · ${String(summary.points_failed)} failed` : ''}
    </p>
  );
}

export function RankGridTab({
  market, settings
}: LocalTabProps) {
  const job = useLocalSeoJob();
  const [keyword, setKeyword] = useState('');
  const [target, setTarget] = useState<IdentityInput>({
    kind: 'cid',
    value: '' 
  });
  const [point, setPoint] = useState(EMPTY_POINT);
  const [size, setSize] = useState('3');
  const [spacing, setSpacing] = useState('2');
  const [confirming, setConfirming] = useState(false);
  const [searched, setSearched] = useState('');
  const gridSize = Number(size) as GridSize;
  const spacingKm = Math.min(10, Math.max(0.25, Number(spacing) || 2));
  const busy = job.state.status === 'starting' || job.state.status === 'running';
  const canRun = keyword.trim() !== '' && hasSearchPoint(point, marketHasPoint(market)) && !busy;

  const run = () => {
    const request: GridJobRequest = {
      kind: 'grid',
      keyword: keyword.trim(),
      grid_size: gridSize,
      spacing_km: spacingKm,
      ...market.marketField,
      ...pointFields(point),
      ...targetFields(target),
    };
    setSearched(localScopeLabel([request.keyword], point, market.city));
    void job.start(request);
  };

  const { state } = job;
  const result = (state.status === 'running' || state.status === 'done') && state.job.kind === 'grid' ? state.job.result : null;
  return (
    <div className="space-y-4">
      <LocalForm
        title="Local rank grid"
        note={`${String(gridSize * gridSize)} Maps searches`}
        footer={<TargetTabHints market={market} settings={settings} />}
        submitLabel="Run grid"
        canSubmit={canRun}
        onSubmit={() => { setConfirming(true); }}
      >
        <TextField label="Keyword" value={keyword} onChange={setKeyword} suggestions={settings.keywords} />
        <IdentityFields identity={target} onChange={setTarget} label={TARGET_LABEL} placeholder={targetPlaceholder(settings)} />
        <SelectField label="Grid" value={size} options={SIZES} onChange={setSize} />
        <PointFields point={point} onChange={setPoint} market={market} />
        <TextField label="Spacing (km, 0.25 to 10)" inputMode="decimal" value={spacing} onChange={setSpacing} />
      </LocalForm>
      <JobProgress state={state} />
      {result !== null && (
        <LocalCard
          title={`Ranks for “${keyword.trim()}”`}
          actions={<LocalExcelButton table={rankGridExport(result.points, searched)} />}
        >
          <GridSummaryLine result={result} />
          <GridMap result={result} />
          <p className="text-xs text-gray-500">Green: top 3 · amber: top 10 · red: lower · grey: not in the top 20 · ×: failed</p>
        </LocalCard>
      )}
      <ConfirmModal
        isOpen={confirming}
        onClose={() => { setConfirming(false); }}
        onConfirm={run}
        title="Run the rank grid?"
        message={`This starts ${String(gridSize * gridSize)} paid DataForSEO calls, one Google Maps search per point. Running the same grid again within an hour reuses them. Continue?`}
        confirmText="Start grid"
      />
    </div>
  );
}
