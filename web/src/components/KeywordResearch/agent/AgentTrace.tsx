import { useState } from 'react';
import type {
  AgentRound, KeywordResearchItem, PlannedQuery
} from '../../../types';
import { dimensionLabel } from './agentBrief';

interface AgentTraceProps {readonly job: KeywordResearchItem;}

function QueryList({ queries }: { readonly queries: PlannedQuery[] }) {
  return (
    <ul className="space-y-1">
      {queries.map((query) => (
        <li key={query.query} className="text-sm text-gray-800 flex flex-wrap items-baseline gap-2">
          <span className="inline-flex px-1.5 py-0.5 rounded bg-gray-100 text-[11px] font-medium text-gray-600">{dimensionLabel(query.dimension)}</span>
          <span className="font-medium">{query.query}</span>
          {query.rationale && <span className="text-xs text-gray-500">— {query.rationale}</span>}
        </li>
      ))}
    </ul>
  );
}

function RoundCard({ round }: { readonly round: AgentRound }) {
  const evaluation = round.evaluation;
  return (
    <li className="rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="text-sm font-medium text-gray-900">Round {round.round}</h5>
        <span className="text-xs text-gray-500">{round.queries.length} quer{round.queries.length === 1 ? 'y' : 'ies'}</span>
      </div>
      {round.strategy && <p className="text-sm text-gray-700 italic">{round.strategy}</p>}
      <QueryList queries={round.queries} />
      {evaluation && (
        <div className="border-t border-gray-200 pt-2 space-y-1">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">
            Evaluation · {evaluation.decision === 'continue' ? 'continue' : 'stop'}
            {evaluation.candidate_count !== undefined && ` · ${evaluation.candidate_count} candidates`}
          </p>
          {evaluation.assessment && <p className="text-sm text-gray-700">{evaluation.assessment}</p>}
          {evaluation.reason && <p className="text-sm text-gray-600">{evaluation.reason}</p>}
        </div>
      )}
    </li>
  );
}

/**
 * The agent's reasoning, kept with the job: the standing instructions it ran
 * with, each round's plan and how it judged the round (R21 — the plan is the
 * agent's, not hard-coded).
 */
export function AgentTrace({ job }: AgentTraceProps) {
  const [open, setOpen] = useState(false);
  const rounds = job.rounds ?? [];
  if (rounds.length === 0 && !job.system_prompt) return null;

  return (
    <section className="bg-white rounded-lg border border-gray-200">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-medium text-gray-900">Agent trace</span>
        <span className="text-xs text-gray-500">{rounds.length} round{rounds.length === 1 ? '' : 's'} · {open ? 'hide' : 'show'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4">
          {job.system_prompt && (
            <details className="text-sm">
              <summary className="cursor-pointer text-gray-700">Instructions used{job.template_name ? ` (${job.template_name})` : ''}</summary>
              <pre className="mt-2 whitespace-pre-wrap text-xs text-gray-600 bg-gray-50 border border-gray-100 rounded p-3 font-sans">{job.system_prompt}</pre>
            </details>
          )}
          {rounds.length > 0 && (
            <ul className="space-y-3">
              {rounds.map((round) => <RoundCard key={round.round} round={round} />)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
