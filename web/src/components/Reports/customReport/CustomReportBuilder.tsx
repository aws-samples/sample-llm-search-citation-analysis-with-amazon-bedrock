import { useParams } from 'react-router-dom';
import { SectionPlaceholder } from '../layout';
import { ReportDraftEditor } from './builder/ReportDraftEditor';
import {
  BackToReportsLink, useSavedReport
} from './savedReport';

function EditableReport({ id }: { readonly id: string }) {
  const saved = useSavedReport(id);
  if (saved.report !== undefined) return <ReportDraftEditor key={saved.report.id} saved={saved.report} />;
  if (saved.variant !== 'empty') return <SectionPlaceholder variant={saved.variant} message={saved.message} />;
  return (
    <div className="space-y-3">
      <SectionPlaceholder variant="empty" message={saved.message} />
      <BackToReportsLink />
    </div>
  );
}

/**
 * The report builder: `/reports/custom/new` starts an empty report,
 * `/reports/custom/:id/edit` opens a saved one.
 */
export function CustomReportBuilder() {
  const { id } = useParams<{ id: string }>();
  return id === undefined ? <ReportDraftEditor saved={null} /> : <EditableReport id={id} />;
}
