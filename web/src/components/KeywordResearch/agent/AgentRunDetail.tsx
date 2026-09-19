import { useMemo } from 'react';
import type {
  Keyword, KeywordGroup, KeywordResearchItem
} from '../../../types';
import { uniqueResearchKeywords } from '../../../hooks/keywordIdentity';
import {
  isActiveResearchStatus, resolveResearchStatus
} from '../../../formatting/researchStatus';
import { ResearchProgress } from '../ResearchProgress';
import { AgentProposal } from './AgentProposal';
import { AgentTrace } from './AgentTrace';
import { dimensionLabel } from './agentBrief';

interface AgentRunDetailProps {
  readonly job: KeywordResearchItem;
  readonly groups: KeywordGroup[];
  readonly onRetry: (job: KeywordResearchItem) => void;
  readonly onClose: () => void;
  readonly onKeywordsAdded?: (created: Keyword[]) => void;
}

function BriefSummary({ job }: { readonly job: KeywordResearchItem }) {
  const config = job.config;
  if (!config) return null;
  const items: [string, string][] = [
    ['Market', `${config.country.toUpperCase()} · ${config.language}`],
    ['Expand by', config.dimensions.map(dimensionLabel).join(', ')],
    ['Target', `${config.target_count} keywords · up to ${config.max_rounds} round${config.max_rounds === 1 ? '' : 's'}`],
  ];
  if (config.instruction) items.push(['Instruction', config.instruction]);
  if (job.template_name) items.push(['Instructions', job.template_name]);
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
      {items.map(([label, value]) => (
        <div key={label} className="flex gap-2 min-w-0">
          <dt className="text-gray-500 shrink-0">{label}</dt>
          <dd className="text-gray-800 truncate" title={value}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One agent run: its brief, live progress (steps per round with the query
 * each one searched), the reasoning trace and — once finished — the
 * proposal to review and add to the hotel's group.
 */
export function AgentRunDetail({
  job, groups, onRetry, onClose, onKeywordsAdded
}: AgentRunDetailProps) {
  const status = resolveResearchStatus(job.status);
  const active = status !== null && isActiveResearchStatus(status);
  const keywords = useMemo(() => uniqueResearchKeywords(job.keywords ?? []), [job.keywords]);

  return (
    <div className="space-y-4" aria-live="polite">
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900 truncate">{job.config?.seed ?? job.seed_keyword ?? 'Research run'}</h3>
            <p className="text-xs text-gray-500">Started {new Date(job.created_at).toLocaleString()}{job.created_by ? ` by ${job.created_by}` : ''}</p>
          </div>
          <button type="button" onClick={onClose} className="text-xs text-gray-500 hover:text-gray-900 underline shrink-0">Close</button>
        </div>
        <BriefSummary job={job} />
      </div>

      <ResearchProgress job={job} onRetry={onRetry} retrying={active} />

      {active && keywords.length > 0 && (
        <p className="text-sm text-gray-600">{keywords.length} candidate keywords found so far — the final list is selected when the last round ends.</p>
      )}

      <AgentTrace job={job} />

      {!active && <AgentProposal job={job} keywords={keywords} groups={groups} onKeywordsAdded={onKeywordsAdded} />}

      {!active && keywords.length === 0 && status !== 'failed' && (
        <p className="text-sm text-gray-500">The run finished without candidates. Try broader dimensions or a different market.</p>
      )}
    </div>
  );
}
