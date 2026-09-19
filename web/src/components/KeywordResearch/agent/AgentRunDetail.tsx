import { useMemo } from 'react';
import type {
  Keyword, KeywordGroup, KeywordResearchItem
} from '../../../types';
import { uniqueResearchKeywords } from '../../../hooks/keywordIdentity';
import {
  isActiveResearchStatus, isRetryableResearchStatus, resolveResearchStatus
} from '../../../formatting/researchStatus';
import { ResearchProgress } from '../ResearchProgress';
import { AgentProposal } from './AgentProposal';
import { AgentTrace } from './AgentTrace';
import {
  dimensionLabel, runCatalog, subjectLabel
} from './agentBrief';

interface AgentRunDetailProps {
  readonly job: KeywordResearchItem;
  readonly groups: KeywordGroup[];
  readonly onRetry: (job: KeywordResearchItem) => void;
  readonly onKeywordsAdded?: (created: Keyword[]) => void;
}

function BriefSummary({ job }: { readonly job: KeywordResearchItem }) {
  const config = job.config;
  if (!config) return null;
  const catalog = runCatalog(job);
  const items: [string, string][] = [
    ['Market', `${config.country.toUpperCase()} · ${config.language}`],
    ['Researched as', `${subjectLabel(config.subject)} · for ${config.audience}`],
    ['Expand by', config.dimensions.map((dimension) => dimensionLabel(dimension, catalog)).join(', ')],
    ['Target', `${config.target_count} keywords · up to ${config.max_rounds} round${config.max_rounds === 1 ? '' : 's'}`],
  ];
  if (config.instruction) items.push(['Instruction', config.instruction]);
  if (job.template_name) items.push(['Template', job.template_name]);
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs bg-gray-50 border border-gray-100 rounded-lg p-3">
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
 * The body of an opened run: its brief, then what the user came for — the
 * proposal once the run has finished, live progress (steps per round with the
 * query each one searched) while it runs or when it needs a retry — and the
 * reasoning trace, collapsed.
 */
export function AgentRunDetail({
  job, groups, onRetry, onKeywordsAdded
}: AgentRunDetailProps) {
  const status = resolveResearchStatus(job.status);
  const active = status !== null && isActiveResearchStatus(status);
  const showProgress = active || isRetryableResearchStatus(job.status);
  const keywords = useMemo(() => uniqueResearchKeywords(job.keywords ?? []), [job.keywords]);

  return (
    <div className="space-y-4" aria-live="polite">
      <BriefSummary job={job} />

      {!active && <AgentProposal job={job} keywords={keywords} groups={groups} onKeywordsAdded={onKeywordsAdded} />}

      {!active && keywords.length === 0 && status !== 'failed' && (
        <p className="text-sm text-gray-500">The run finished without candidates. Try broader dimensions or a different market.</p>
      )}

      {showProgress && <ResearchProgress job={job} onRetry={onRetry} retrying={active} />}

      {active && keywords.length > 0 && (
        <p className="text-sm text-gray-600">{keywords.length} candidate keywords found so far — the final list is selected when the last round ends.</p>
      )}

      <AgentTrace job={job} />
    </div>
  );
}
