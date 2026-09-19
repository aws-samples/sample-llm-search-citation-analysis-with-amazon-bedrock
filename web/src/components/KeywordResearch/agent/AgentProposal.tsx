import {
  useEffect, useMemo, useState
} from 'react';
import type {
  AgentDimensionOption, Keyword, KeywordGroup, KeywordResearchItem, ResearchKeyword
} from '../../../types';
import {
  SELECTION_LIMIT, promotionSuccessMessage, usePromoteKeywords
} from '../../../hooks/usePromoteKeywords';
import { keywordSelectionKey } from '../../../hooks/keywordIdentity';
import { Button } from '../../ui';
import { Spinner } from '../../ui/Spinner';
import {
  OTHER_DIMENSION_ID, dimensionLabel, orderedDimensionIds, runCatalog
} from './agentBrief';
import { exportAgentRun } from './agentExport';

interface AgentProposalProps {
  readonly job: KeywordResearchItem;
  readonly keywords: ResearchKeyword[];
  readonly groups: KeywordGroup[];
  readonly onKeywordsAdded?: (created: Keyword[]) => void;
}

interface DimensionSection {
  id: string;
  label: string;
  keywords: ResearchKeyword[];
}

/** Group the proposal by dimension in the catalogue's order; ids the catalogue does not know go under "Other", last. */
export function groupProposalByDimension(keywords: ResearchKeyword[], catalog: readonly AgentDimensionOption[]): DimensionSection[] {
  const order = orderedDimensionIds(catalog);
  const buckets = new Map<string, ResearchKeyword[]>();
  for (const keyword of keywords) {
    const id = order.includes(keyword.dimension ?? '') ? (keyword.dimension ?? OTHER_DIMENSION_ID) : OTHER_DIMENSION_ID;
    buckets.set(id, [...(buckets.get(id) ?? []), keyword]);
  }
  return order
    .filter((id) => buckets.has(id))
    .map((id) => ({
      id,
      label: dimensionLabel(id, catalog),
      keywords: buckets.get(id) ?? [],
    }));
}

function relevanceClass(relevance: number): string {
  if (relevance >= 8) return 'text-green-700';
  if (relevance >= 5) return 'text-gray-700';
  return 'text-gray-400';
}

function trackingLabel(keyword: ResearchKeyword): string {
  if (keyword.tracking === true) return 'Recommended';
  if (keyword.tracking === false) return 'Library';
  return 'Not scored (legacy run)';
}

/**
 * The agent's final list, grouped by dimension with adjustable tracking
 * checkboxes. Recommended terms start selected. Operators can either add only
 * that active selection or save the whole proposal in one mixed-status request
 * (selected active, unselected inactive), preserving the chosen group.
 */
export function AgentProposal({
  job, keywords, groups, onKeywordsAdded
}: AgentProposalProps) {
  const [groupId, setGroupId] = useState(job.config?.group_id ?? '');
  const [exporting, setExporting] = useState(false);
  const groupIds = useMemo(() => (groupId === '' ? [] : [groupId]), [groupId]);
  const recommendedKeywords = useMemo(
    () => keywords.filter((keyword) => keyword.tracking === true).map((keyword) => keyword.keyword),
    [keywords]
  );
  const promotion = usePromoteKeywords(keywords, onKeywordsAdded, { groupIds });
  const {
    replaceSelection, toggle, selected
  } = promotion;
  const selectedKeys = useMemo(() => new Set(selected), [selected]);
  const sections = useMemo(() => groupProposalByDimension(keywords, runCatalog(job)), [keywords, job]);
  const groupName = groups.find((group) => group.id === groupId)?.name;
  const targetText = groupName === undefined ? '' : ` to “${groupName}”`;
  const inactiveCount = keywords.length - promotion.selectedCount;

  useEffect(() => {
    replaceSelection(recommendedKeywords);
  }, [job.id, recommendedKeywords, replaceSelection]);

  useEffect(() => {
    setGroupId(job.config?.group_id ?? '');
  }, [job.id, job.config?.group_id]);

  const toggleSection = (section: DimensionSection, select: boolean) => {
    for (const keyword of section.keywords) {
      const isSelected = selectedKeys.has(keywordSelectionKey(keyword.keyword));
      if (isSelected !== select) toggle(keyword.keyword);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportAgentRun(job, keywords);
    } catch (exportError) {
      console.error('[research-agent] Error exporting run:', exportError);
    } finally {
      setExporting(false);
    }
  };

  if (keywords.length === 0) return null;

  return (
    <section className="bg-white rounded-lg border border-gray-200" aria-label="Proposed keywords">
      <div className="p-4 border-b border-gray-100 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h4 className="text-sm font-medium text-gray-900">
              {keywords.length} proposed keywords
              {job.candidates_count !== undefined && job.candidates_count > 0 && (
                <span className="text-gray-500 font-normal"> · selected from {job.candidates_count} candidates</span>
              )}
            </h4>
            <p className="text-xs text-gray-500 mt-0.5">
              {job.proposal_source === 'fallback'
                ? 'The selection model was unavailable; showing the deterministic fallback proposal.'
                : 'Ranked by the agent; adjust the recommended tracking subset before adding keywords.'}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              Tracking recommendations are a demand proxy based on relevance, intent, provider agreement and Google signals—not measured search volume.
            </p>
          </div>
          <Button type="button" variant="secondary" size="sm" disabled={exporting} onClick={() => void handleExport()}>
            {exporting ? 'Exporting…' : 'Export to Excel'}
          </Button>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-end gap-3">
          <div className="flex-1">
            <label htmlFor={`agent-group-${job.id}`} className="block text-xs text-gray-600 mb-1">Keyword group</label>
            <select
              id={`agent-group-${job.id}`}
              value={groupId}
              onChange={(event) => setGroupId(event.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-200"
            >
              <option value="">No group (just add to Keywords)</option>
              {[...groups]
                .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
                .map((group) => <option key={group.id} value={group.id}>{group.name} ({group.keyword_count})</option>)}
            </select>
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={recommendedKeywords.length === 0 || promotion.submitting}
            onClick={() => replaceSelection(recommendedKeywords)}
          >
            Reset to recommended ({recommendedKeywords.length})
          </Button>
        </div>

        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-2">
          <p
            className="text-sm text-gray-700"
            aria-label={`${promotion.selectedCount} selected active tracked keywords, ${inactiveCount} unselected inactive library keywords`}
          >
            <strong>{promotion.selectedCount}</strong> selected → active tracked keywords · <strong>{inactiveCount}</strong> unselected → inactive library keywords
          </p>
          <p className="text-xs text-gray-500">Selection limit: {SELECTION_LIMIT}. Inactive library keywords stay in the group but are excluded from analysis runs.</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button type="button" disabled={!promotion.canPromote} onClick={() => void promotion.promote()}>
              {promotion.submittingAction === 'selected' ? (
                <>
                  <Spinner size="sm" />
                  Adding selected…
                </>
              ) : `Add selected as active (${promotion.selectedCount})${targetText}`}
            </Button>
            <Button type="button" variant="secondary" disabled={!promotion.canPromoteProposal} onClick={() => void promotion.promoteProposal()}>
              {promotion.submittingAction === 'proposal' ? (
                <>
                  <Spinner size="sm" />
                  Adding full proposal…
                </>
              ) : `Add full proposal (${promotion.selectedCount} active, ${inactiveCount} inactive)${targetText}`}
            </Button>
          </div>
        </div>

        <output className="block space-y-1">
          {promotion.limitMessage && <span className="block text-sm text-amber-700">{promotion.limitMessage}</span>}
          {promotion.outcome && <span className="block text-sm text-green-700">{promotionSuccessMessage(promotion.outcome)}</span>}
        </output>
        {promotion.error && (
          <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{promotion.error}</div>
        )}
      </div>

      <div className="divide-y divide-gray-100">
        {sections.map((section) => {
          const allSelected = section.keywords.every((keyword) => selectedKeys.has(keywordSelectionKey(keyword.keyword)));
          return (
            <div key={section.id} className="p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-600">{section.label} <span className="font-normal text-gray-400">({section.keywords.length})</span></h5>
                <button type="button" onClick={() => toggleSection(section, !allSelected)} className="text-xs text-gray-600 hover:text-gray-900 underline">
                  {allSelected ? 'Clear section' : 'Select section'}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500">
                      <th className="w-8 py-1" scope="col"><span className="sr-only">Select</span></th>
                      <th className="py-1 pr-3 font-medium" scope="col">Keyword</th>
                      <th className="py-1 pr-3 font-medium" scope="col">Tracking recommendation</th>
                      <th className="py-1 pr-3 font-medium" scope="col">Intent</th>
                      <th className="py-1 pr-3 font-medium" scope="col">Competition</th>
                      <th className="py-1 pr-3 font-medium" scope="col">Relevance</th>
                      <th className="py-1 pr-3 font-medium hidden lg:table-cell" scope="col">Why proposed</th>
                      <th className="py-1 font-medium hidden md:table-cell" scope="col">Sources</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {section.keywords.map((keyword) => {
                      const key = keywordSelectionKey(keyword.keyword);
                      const checked = selectedKeys.has(key);
                      return (
                        <tr key={key} className={checked ? 'bg-gray-50' : ''}>
                          <td className="py-1.5">
                            <input type="checkbox" checked={checked} onChange={() => toggle(keyword.keyword)} aria-label={`Select ${keyword.keyword}`} className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-500" />
                          </td>
                          <td className="py-1.5 pr-3 font-medium text-gray-900">{keyword.keyword}</td>
                          <td className="py-1.5 pr-3 text-gray-600 max-w-sm">
                            <span className={keyword.tracking === true ? 'font-medium text-green-700' : ''}>{trackingLabel(keyword)}</span>
                            {keyword.tracking_score !== undefined && <span className="block text-xs">Score {keyword.tracking_score}</span>}
                            {keyword.tracking_reason && <span className="block text-xs text-gray-500">{keyword.tracking_reason}</span>}
                          </td>
                          <td className="py-1.5 pr-3 text-gray-600 capitalize">{keyword.intent}</td>
                          <td className="py-1.5 pr-3 text-gray-600 capitalize">{keyword.competition}</td>
                          <td className={`py-1.5 pr-3 font-medium ${relevanceClass(keyword.relevance)}`}>{keyword.relevance}</td>
                          <td className="py-1.5 pr-3 text-gray-500 hidden lg:table-cell max-w-md">{keyword.rationale}</td>
                          <td className="py-1.5 text-gray-500 hidden md:table-cell">{(keyword.providers ?? []).join(', ')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
