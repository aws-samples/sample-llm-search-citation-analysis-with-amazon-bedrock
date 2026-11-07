/**
 * Create or edit a rank tracker (Admin). A new tracker starts from Settings: the brand's first own domain,
 * the header market and every keyword of that market. Saving first asks the free estimate and shows the paid
 * searches it starts (per check and, for a scheduled tracker, how many checks a month) for confirmation before
 * anything is stored, since a scheduled tracker starts paid calls on its own.
 */
import { useState } from 'react';
import type { CompetitorDomain } from '../../../api/brandSettings';
import { marketRequestField } from '../../../api/marketRequestField';
import {
  addRankKeywords, createRankTracker, estimateRankTracker, updateRankTracker
} from '../../../api/seoRankTracking';
import { useKeywordGroups } from '../../../hooks/useKeywordGroups';
import type {
  RankEstimate, RankTracker, RankTrackerSettings
} from '../../../types/api/seoRankTracking';
import { SettingsHint } from '../SettingsHint';
import {
  DEFAULT_DRAFT, TrackerFormFields, draftDomain, draftKeywords, isDraftComplete, type TrackerDraft
} from './TrackerFormFields';
import {
  ReviewStepModal, useReviewStep
} from './ReviewStepModal';
import {
  keywordCapNote, rankDomainOptions
} from './rankTrackingFormat';

interface Props {
  readonly tracker: RankTracker | null;
  readonly marketId: string | null;
  readonly marketLabel: string;
  /** Settings › Brand Tracking: the brand's own domains and the competitors'. */
  readonly ownedDomains: readonly string[];
  readonly competitors: readonly CompetitorDomain[];
  readonly onClose: () => void;
  readonly onSaved: (tracker: RankTracker) => void;
}

function draftOf(props: Props): TrackerDraft {
  const { tracker } = props;
  if (tracker === null) {
    const domain = props.ownedDomains[0] ?? props.competitors[0]?.domain ?? '';
    return {
      ...DEFAULT_DRAFT,
      domain,
    };
  }
  return {
    ...DEFAULT_DRAFT,
    domain: tracker.domain,
    devices: tracker.devices,
    depth: tracker.depth,
    schedule: tracker.schedule,
    keywordScope: tracker.keyword_scope,
    groupId: tracker.group_id ?? '',
  };
}

/** The settings a save sends; an older tracker of extra keywords only keeps its scope unless one is chosen. */
function settingsOf(draft: TrackerDraft): RankTrackerSettings {
  const scope = draft.keywordScope === 'list' ? {} : { keyword_scope: draft.keywordScope };
  return {
    devices: draft.devices,
    depth: draft.depth,
    schedule: draft.schedule,
    ...scope,
    ...(draft.keywordScope === 'group' ? { group_id: draft.groupId } : {}),
  };
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

/** What a check starts, in paid calls (never a price), and the question before it starts. */
export function CheckSummary({
  estimate, scheduled
}: {
  readonly estimate: RankEstimate;
  readonly scheduled: boolean
}) {
  const capNote = keywordCapNote(estimate);
  return (
    <div className="text-sm text-gray-700 dark:text-gray-200 space-y-1">
      <p>
        {`Each check starts ${plural(estimate.pairs, 'paid DataForSEO call', 'paid DataForSEO calls')} `}
        {`for ${plural(estimate.keyword_count, 'keyword', 'keywords')}, plus up to two re-checks of a keyword that is not found.`}
      </p>
      {capNote !== null && <p className="text-amber-700 dark:text-amber-400">{capNote}</p>}
      {estimate.keyword_count === 0 && (
        <SettingsHint section="keywords">There are no keywords to check yet: checks are skipped until keywords are added.</SettingsHint>
      )}
      {scheduled && <p>{`The schedule runs about ${plural(estimate.checks_per_month, 'check', 'checks')} a month.`}</p>}
      <p>Continue?</p>
    </div>
  );
}

async function saveTracker(props: Props, draft: TrackerDraft): Promise<RankTracker> {
  const keywords = draftKeywords(draft.keywordsText);
  if (props.tracker !== null) {
    const { tracker } = await updateRankTracker(props.tracker.tracker_id, settingsOf(draft));
    if (keywords.length === 0) return tracker;
    const changed = await addRankKeywords(tracker.tracker_id, keywords);
    return {
      ...tracker,
      extra_keyword_count: changed.keyword_count,
    };
  }
  const saved = await createRankTracker({
    ...settingsOf(draft),
    domain: draftDomain(draft),
    keywords,
    ...marketRequestField(props.marketId),
  });
  return saved.tracker;
}

export function TrackerFormModal(props: Props) {
  const { groups } = useKeywordGroups();
  const [draft, setDraft] = useState<TrackerDraft>(() => draftOf(props));
  const {
    estimate, setEstimate, request, attempt
  } = useReviewStep();

  const review = () => attempt(async () => {
    setEstimate(await estimateRankTracker({
      ...settingsOf(draft),
      ...(props.tracker === null ? marketRequestField(props.marketId) : { tracker_id: props.tracker.tracker_id }),
      keywords: draftKeywords(draft.keywordsText),
    }));
  });
  const confirm = () => attempt(async () => props.onSaved(await saveTracker(props, draft)));

  return (
    <ReviewStepModal
      title={props.tracker === null ? 'Track a domain' : 'Edit tracker'} request={request} reviewing={estimate !== null}
      canReview={isDraftComplete(draft)} confirmLabel="Confirm and save" onClose={props.onClose}
      onBack={() => setEstimate(null)} onReview={review} onConfirm={confirm}
    >
      {estimate === null ? (
        <TrackerFormFields
          draft={draft} editing={props.tracker !== null} legacyList={props.tracker?.keyword_scope === 'list'}
          marketLabel={props.marketLabel} domainOptions={rankDomainOptions(props.ownedDomains, props.competitors)}
          hasOwnedDomain={props.ownedDomains.length > 0} groups={groups} onChange={setDraft}
        />
      ) : <CheckSummary estimate={estimate} scheduled={draft.schedule !== 'manual'} />}
    </ReviewStepModal>
  );
}
