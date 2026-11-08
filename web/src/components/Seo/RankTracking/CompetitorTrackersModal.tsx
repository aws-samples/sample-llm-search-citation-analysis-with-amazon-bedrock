/**
 * "Track competitors" (Admin): one tracker per competitor domain of Settings › Brand Tracking, in the header
 * market, on the same keywords and defaults as the brand's own tracker (every keyword of the market, mobile,
 * top 30, weekly). The paid calls of one check are confirmed, per tracker and in total, before anything is stored.
 */
import { useState } from 'react';
import type { CompetitorDomain } from '../../../api/brandSettings';
import { marketRequestField } from '../../../api/marketRequestField';
import {
  createRankTracker, estimateRankTracker
} from '../../../api/seoRankTracking';
import { seoErrorMessage } from '../../../api/seo';
import type { RankTrackerSettings } from '../../../types/api/seoRankTracking';
import {
  ReviewStepModal, useReviewStep
} from './ReviewStepModal';
import { CheckSummary } from './TrackerFormModal';

/** The settings the one-click trackers are created with. */
export const ONE_CLICK_SETTINGS: RankTrackerSettings = {
  devices: 'mobile',
  depth: 30,
  schedule: 'weekly',
  keyword_scope: 'all',
};

interface Props {
  /** The competitor domains not yet tracked in the market. */
  readonly competitors: readonly CompetitorDomain[];
  readonly marketId: string | null;
  readonly marketLabel: string;
  readonly onClose: () => void;
  /** Called once every chosen tracker was created or refused, with the refusals' messages. */
  readonly onSaved: (refusals: readonly string[]) => void;
}

/** Creates the trackers one after the other; the messages of the ones refused. */
async function createAll(domains: readonly string[], marketId: string | null): Promise<string[]> {
  const refusals: string[] = [];
  for (const domain of domains) {
    try {
      await createRankTracker({
        ...ONE_CLICK_SETTINGS,
        domain,
        ...marketRequestField(marketId),
      });
    } catch (failure) {
      refusals.push(`${domain}: ${seoErrorMessage(failure)}`);
    }
  }
  return refusals;
}

function CompetitorChoices({
  competitors, chosen, onToggle
}: {
  readonly competitors: readonly CompetitorDomain[];
  readonly chosen: ReadonlySet<string>;
  readonly onToggle: (domain: string) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-gray-700 dark:text-gray-200">Competitor domains (from Settings › Brand Tracking)</legend>
      {competitors.map((competitor) => (
        <label key={competitor.domain} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={chosen.has(competitor.domain)} onChange={() => onToggle(competitor.domain)} />
          {`${competitor.name} (${competitor.domain})`}
        </label>
      ))}
    </fieldset>
  );
}

export function CompetitorTrackersModal({
  competitors, marketId, marketLabel, onClose, onSaved
}: Props) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(competitors.map((competitor) => competitor.domain)));
  const {
    estimate, setEstimate, request, attempt
  } = useReviewStep();
  const domains = competitors.map((competitor) => competitor.domain).filter((domain) => chosen.has(domain));

  const toggle = (domain: string) => {
    const next = new Set(chosen);
    if (!next.delete(domain)) next.add(domain);
    setChosen(next);
  };
  const review = () => attempt(async () => {
    setEstimate(await estimateRankTracker({
      ...ONE_CLICK_SETTINGS,
      ...marketRequestField(marketId),
    }));
  });
  const confirm = () => attempt(async () => {
    onSaved(await createAll(domains, marketId));
  });

  return (
    <ReviewStepModal
      title="Track competitors" request={request} reviewing={estimate !== null} canReview={domains.length > 0}
      confirmLabel="Confirm and create" onClose={onClose} onBack={() => setEstimate(null)} onReview={review} onConfirm={confirm}
    >
      <p className="text-sm text-gray-600 dark:text-gray-300">
        {`One tracker per competitor (market: ${marketLabel}), on the same keywords as yours: all tracked keywords of the market, mobile, top 30, weekly.`}
      </p>
      {estimate === null ? (
        <CompetitorChoices competitors={competitors} chosen={chosen} onToggle={toggle} />
      ) : (
        <>
          <p className="text-sm text-gray-700 dark:text-gray-200">
            {`${domains.length.toLocaleString('en-US')} ${domains.length === 1 ? 'tracker' : 'trackers'}; for each of them:`}
          </p>
          <CheckSummary estimate={estimate} scheduled />
        </>
      )}
    </ReviewStepModal>
  );
}
