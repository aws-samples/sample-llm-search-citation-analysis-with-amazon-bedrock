import type {
  Keyword, KeywordGroup, KeywordResearchItem
} from '../../../types';
import { Modal } from '../../ui/Modal';
import { AgentRunDetail } from './AgentRunDetail';

interface AgentRunModalProps {
  /** The opened run, or null when no run is open. Keeps updating while the run is active. */
  readonly job: KeywordResearchItem | null;
  readonly groups: KeywordGroup[];
  readonly onClose: () => void;
  readonly onRetry: (job: KeywordResearchItem) => void;
  readonly onKeywordsAdded?: (created: Keyword[]) => void;
}

/** "Hotels · started 18/09/2026, 12:00:00 by ana" */
export function describeRunOrigin(job: KeywordResearchItem): string {
  const template = job.template_name ? `${job.template_name} · ` : '';
  const by = job.created_by ? ` by ${job.created_by}` : '';
  return `${template}started ${new Date(job.created_at).toLocaleString()}${by}`;
}

/**
 * The opened run in a dialog over the runs list: seed as the title, the
 * template and start time as the subtitle, then the run's detail (brief,
 * proposal or progress, trace). Closing it only hides it — the run keeps
 * going in the background.
 */
export function AgentRunModal({
  job, groups, onClose, onRetry, onKeywordsAdded
}: AgentRunModalProps) {
  if (job === null) return null;
  return (
    <Modal isOpen onClose={onClose} title={job.config?.seed ?? job.seed_keyword ?? 'Research run'} size="4xl">
      <div className="space-y-4">
        <p className="text-xs text-gray-500">{describeRunOrigin(job)}</p>
        <AgentRunDetail job={job} groups={groups} onRetry={onRetry} onKeywordsAdded={onKeywordsAdded} />
      </div>
    </Modal>
  );
}
