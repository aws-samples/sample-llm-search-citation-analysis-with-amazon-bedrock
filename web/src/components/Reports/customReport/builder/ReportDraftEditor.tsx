import {
  useId, useState
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createCustomReport, deleteCustomReport, MAX_REPORT_BLOCKS, MAX_REPORT_TITLE_LENGTH, updateCustomReport, type CustomReport,
  type CustomReportDays
} from '../../../../api/customReports';
import { Button } from '../../../ui';
import { ConfirmModal } from '../../../ui/Modal';
import { PeriodSelector } from '../../scopeReport/ScopeReport';
import {
  blockName, type CatalogEntry
} from '../blockCatalog';
import { customReportPath } from '../customReportRoute';
import { BlockCatalogPanel } from './BlockCatalogPanel';
import { ReportCanvas } from './ReportCanvas';
import {
  draftInput, draftProblem, saveFailureMessage
} from './reportDraft';
import { useReportDraft } from './useReportDraft';

/** What is being dragged: a block from the list, or one already in the report. */
type DragPayload =
  | {
    readonly kind: 'new';
    readonly entry: CatalogEntry;
  }
  | {
    readonly kind: 'move';
    readonly key: string;
  };

type SaveMode = 'update' | 'create';

interface Props {
  /** The report being edited; `null` builds a new one. */
  readonly saved: CustomReport | null;
}

/**
 * The report builder: a name and a period, the block list, and the report's
 * blocks in order. Saving opens the report; editing a saved one can also
 * save a copy or delete it.
 */
export function ReportDraftEditor({ saved }: Props) {
  const navigate = useNavigate();
  const {
    draft, setTitle, setDays, addBlock, moveTo, shift, remove, replace
  } = useReportDraft(saved);
  const [drag, setDrag] = useState<DragPayload | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [revealProblems, setRevealProblems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const usedTypes = new Set(draft.items.map((item) => item.block.type));
  const full = draft.items.length >= MAX_REPORT_BLOCKS;

  const add = (entry: CatalogEntry, at?: number) => {
    addBlock(entry.create(), at);
    setAnnouncement(`Added ${blockName(entry.type)} at position ${(at ?? draft.items.length) + 1}.`);
  };
  const dropAt = (gap: number) => {
    if (drag?.kind === 'new' && !full) add(drag.entry, gap);
    if (drag?.kind === 'move') moveTo(drag.key, gap);
    setDrag(null);
  };

  const save = async (mode: SaveMode) => {
    const refusal = draftProblem(draft);
    setProblem(refusal);
    setRevealProblems(refusal !== null);
    if (refusal !== null) return;
    setSaving(true);
    try {
      const input = draftInput(draft);
      const report = saved !== null && mode === 'update' ? await updateCustomReport(saved.id, input) : await createCustomReport(input);
      navigate(customReportPath(report.id));
    } catch (error) {
      setProblem(saveFailureMessage(error));
      setSaving(false);
    }
  };

  const removeSaved = async (report: CustomReport) => {
    setSaving(true);
    try {
      await deleteCustomReport(report.id);
      navigate('/reports');
    } catch (error) {
      setProblem(saveFailureMessage(error));
      setSaving(false);
    }
  };

  return (
    <>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save('update');
        }}
        className="space-y-6"
      >
        <DraftDetails
          heading={saved === null ? 'Create a custom report' : 'Edit custom report'}
          title={draft.title}
          days={draft.days}
          onTitleChange={setTitle}
          onDaysChange={setDays}
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <BlockCatalogPanel
            usedTypes={usedTypes}
            full={full}
            onAdd={(entry) => add(entry)}
            onDragStart={(entry) => setDrag({
              kind: 'new',
              entry,
            })}
            onDragEnd={() => setDrag(null)}
          />
          <ReportCanvas
            items={draft.items}
            dragging={drag !== null}
            onDropAt={dropAt}
            revealProblems={revealProblems}
            announcement={announcement}
            onShift={shift}
            onRemove={remove}
            onChange={replace}
            onItemDragStart={(key) => setDrag({
              kind: 'move',
              key,
            })}
            onDragEnd={() => setDrag(null)}
          />
        </div>

        {problem !== null && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{problem}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save report'}</Button>
          {saved !== null && (
            <>
              <Button variant="secondary" disabled={saving} onClick={() => void save('create')}>Save as new report</Button>
              <Button variant="ghost" disabled={saving} onClick={() => setConfirmingDelete(true)}>Delete report</Button>
            </>
          )}
          <Button variant="ghost" disabled={saving} onClick={() => navigate(saved === null ? '/reports' : customReportPath(saved.id))}>Cancel</Button>
        </div>
      </form>

      {saved !== null && (
        <ConfirmModal
          isOpen={confirmingDelete}
          onClose={() => setConfirmingDelete(false)}
          onConfirm={() => void removeSaved(saved)}
          title="Delete this report?"
          message={`"${saved.title}" will be removed for everyone. This cannot be undone.`}
          confirmText="Delete report"
          confirmVariant="danger"
        />
      )}
    </>
  );
}

interface DetailsProps {
  readonly heading: string;
  readonly title: string;
  readonly days: CustomReportDays;
  readonly onTitleChange: (title: string) => void;
  readonly onDaysChange: (days: CustomReportDays) => void;
}

/** The page heading, the report name and its period. */
function DraftDetails({
  heading, title, days, onTitleChange, onDaysChange
}: DetailsProps) {
  const titleId = useId();
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-gray-900 sm:text-xl">{heading}</h2>
      <p className="mt-1 text-sm text-gray-500">
        Name the report, add the blocks you want and put them in order. Everyone on the dashboard can open saved reports.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <label htmlFor={titleId} className="block text-sm font-medium text-gray-700 mb-1">Report name</label>
          <input
            id={titleId}
            type="text"
            value={title}
            maxLength={MAX_REPORT_TITLE_LENGTH}
            placeholder="e.g. Monthly AI visibility for the board"
            onChange={(event) => onTitleChange(event.target.value)}
            className="w-full p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-gray-900"
          />
        </div>
        <PeriodSelector days={days} onChange={onDaysChange} />
      </div>
    </div>
  );
}
