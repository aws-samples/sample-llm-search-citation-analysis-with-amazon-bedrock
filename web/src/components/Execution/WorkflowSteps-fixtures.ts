import type { StepState } from '../../formatting/executionProcessor';
import { buildKeywordProgress } from '../../formatting/executionProcessorFixtures';

/** The three workflow steps with ProcessKeywords in `status`, holding `keywords` counts (none for `null`). */
export function buildWorkflowSteps(
  status: StepState['status'],
  keywords: StepState['keywords'] | null = buildKeywordProgress()
): StepState[] {
  return [
    {
      name: 'ParseKeywords',
      status: 'completed' 
    },
    {
      name: 'ProcessKeywords',
      status,
      description: 'Search, dedupe and crawl per keyword',
      keywords: keywords ?? undefined,
    },
    {
      name: 'GenerateSummary',
      status: 'pending' 
    },
  ];
}
