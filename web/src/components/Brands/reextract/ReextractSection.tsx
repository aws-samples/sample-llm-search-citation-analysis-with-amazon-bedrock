import { useState } from 'react';
import { useIsAdmin } from '../../../hooks/useIsAdmin';
import { useKeywordGroups } from '../../../hooks/useKeywordGroups';
import {
  useReextract, type EstimateForFilters
} from '../../../hooks/useReextract';
import { Button } from '../../ui';
import { ErrorAlert } from '../../ui/ErrorAlert';
import { ConfirmModal } from '../../ui/Modal';
import { integerText } from '../../ui/numberFormat';
import { ConfigSection } from '../ConfigSection';
import {
  ReextractEstimateLine, estimateSummary
} from './ReextractEstimateLine';
import { ReextractFilterFields } from './ReextractFilterFields';
import { ReextractJobPanel } from './ReextractJobPanel';
import {
  INITIAL_REEXTRACT_FORM, reextractFilters, sameFilters, type ReextractForm
} from './reextractForm';

const DESCRIPTION = 'Answers stored before the current brand-name rule list a chain\'s properties under the chain. '
  + 'Re-extracting runs the brand extraction again on the stored answers (no new AI engine calls, only Bedrock), '
  + 'keeps the previous result on each answer, and rebuilds the KPIs.';

/** The answers the shown estimate counted, when it still describes the form and there is something to do. */
function startableAnswers(estimate: EstimateForFilters | null, form: ReextractForm): number | null {
  if (estimate === null || !sameFilters(estimate.filters, reextractFilters(form))) return null;
  return estimate.result.answers > 0 ? estimate.result.answers : null;
}

function ReextractPanel() {
  const {
    groups, error: groupsError
  } = useKeywordGroups();
  const reextract = useReextract();
  const [form, setForm] = useState<ReextractForm>(INITIAL_REEXTRACT_FORM);
  const [confirming, setConfirming] = useState(false);
  const filters = reextractFilters(form);
  const { estimate } = reextract;
  const job = reextract.status?.job ?? null;
  const active = reextract.status?.active === true;
  const answers = startableAnswers(estimate, form);
  const idle = reextract.busy === null;

  return (
    <ConfigSection title="Re-extract stored answers" description={DESCRIPTION}>
      <ReextractFilterFields form={form} groups={groups} groupsError={groupsError} onChange={setForm} />
      {estimate !== null && <ReextractEstimateLine estimate={estimate.result} outdated={!sameFilters(estimate.filters, filters)} />}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={!idle} onClick={() => { void reextract.runEstimate(filters); }}>
          {reextract.busy === 'estimating' ? 'Estimating…' : 'Estimate'}
        </Button>
        <Button disabled={answers === null || active || !idle} onClick={() => setConfirming(true)}>
          {answers === null ? 'Re-extract' : `Re-extract ${integerText(answers)} answers`}
        </Button>
      </div>
      <ErrorAlert message={reextract.error} />
      {job !== null && <ReextractJobPanel job={job} stopping={reextract.busy === 'stopping'} onStop={(id) => { void reextract.stop(id); }} />}
      <ConfirmModal
        isOpen={confirming && estimate !== null}
        onClose={() => setConfirming(false)}
        onConfirm={() => { void reextract.start(filters); }}
        title="Re-extract stored answers?"
        message={estimate === null ? '' : `${estimateSummary(estimate.result)}. The previous result stays on each answer, and the KPIs are rebuilt when the job ends.`}
        confirmText="Re-extract"
      />
    </ConfigSection>
  );
}

/** Settings › Brand tracking: re-extract stored answers under the current brand-name rule (Admins only). */
export function ReextractSection() {
  const { isAdmin } = useIsAdmin();
  return isAdmin ? <div className="mt-6"><ReextractPanel /></div> : null;
}
