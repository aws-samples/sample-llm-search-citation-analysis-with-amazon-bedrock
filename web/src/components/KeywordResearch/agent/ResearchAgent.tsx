import { useResearchAgent } from '../../../hooks/useResearchAgent';
import { useResearchTemplates } from '../../../hooks/useResearchTemplates';
import { useKeywordGroups } from '../../../hooks/useKeywordGroups';
import type { Keyword } from '../../../types';
import { AgentBriefForm } from './AgentBriefForm';
import { AgentRunDetail } from './AgentRunDetail';
import { AgentRunList } from './AgentRunList';

interface ResearchAgentProps {readonly onKeywordsAdded?: (created: Keyword[]) => void;}

/**
 * Research Agent tab: brief → background runs → review. The brief form stays
 * usable while runs execute (several can be in flight), the list re-reads
 * the active ones, and the opened run shows its trace and proposal.
 */
export function ResearchAgent({ onKeywordsAdded }: ResearchAgentProps) {
  const agent = useResearchAgent();
  const templates = useResearchTemplates();
  const { groups } = useKeywordGroups();

  return (
    <div className="space-y-6">
      <AgentBriefForm
        groups={groups}
        templates={templates.templates}
        templatesLoading={templates.loading}
        starting={agent.starting}
        onStart={agent.start}
        onSaveTemplate={(name, systemPrompt) => templates.create({
          name,
          systemPrompt,
        })}
        onUpdateTemplate={(id, systemPrompt) => templates.update(id, { systemPrompt })}
        onDeleteTemplate={templates.remove}
      />

      {(agent.error ?? templates.error) && (
        <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {agent.error ?? templates.error}
        </div>
      )}

      {agent.selected && (
        <AgentRunDetail
          job={agent.selected}
          groups={groups}
          onRetry={(job) => void agent.retry(job)}
          onClose={() => agent.select(null)}
          onKeywordsAdded={onKeywordsAdded}
        />
      )}

      <section aria-label="Research runs" className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-900">Runs</h3>
          <button type="button" onClick={() => void agent.refresh()} className="text-xs text-gray-500 hover:text-gray-900 underline">Refresh</button>
        </div>
        <AgentRunList
          jobs={agent.jobs}
          selectedId={agent.selectedId}
          loading={agent.loadingJobs}
          onSelect={agent.select}
          onRetry={(job) => void agent.retry(job)}
          onDelete={(id) => void agent.remove(id)}
        />
      </section>
    </div>
  );
}
