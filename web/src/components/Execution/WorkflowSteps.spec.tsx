import {
  render, screen, within
} from '@testing-library/react';
import {
  describe, expect, it
} from 'vitest';
import { buildKeywordProgress } from '../../formatting/executionProcessorFixtures';
import { WorkflowSteps } from './WorkflowSteps';
import { buildWorkflowSteps } from './WorkflowSteps-fixtures';

describe('WorkflowSteps', () => {
  const renderSteps = (...args: Parameters<typeof buildWorkflowSteps>) => render(
    <WorkflowSteps steps={buildWorkflowSteps(...args)} />
  );
  const getKeywordStepElement = () => within(screen.getAllByRole('listitem')[1]);

  it.each(['running', 'completed'] as const)(
    'shows finished of total keywords under ProcessKeywords when the step is %s',
    (status) => {
      renderSteps(status);

      expect(getKeywordStepElement().getByText('10 of 20 keywords')).toBeInTheDocument();
    }
  );

  it('shows the failed keyword count when keywords failed', () => {
    renderSteps('running', buildKeywordProgress({ keywords_failed: 3 }));

    expect(getKeywordStepElement().getByText('3 failed')).toBeInTheDocument();
  });

  it('omits the failed keyword count when no keyword failed', () => {
    renderSteps('running', buildKeywordProgress({
      keywords_succeeded: 10,
      keywords_failed: 0 
    }));

    expect(getKeywordStepElement().getByText('10 of 20 keywords')).toBeInTheDocument();
    expect(screen.queryByText(/failed/u)).not.toBeInTheDocument();
  });

  it('shows no keyword count when the step has no counts yet', () => {
    renderSteps('running', null);

    expect(screen.queryByText(/keywords$/u)).not.toBeInTheDocument();
  });

  it('describes the ProcessKeywords step in words', () => {
    renderSteps('running');

    expect(getKeywordStepElement().getByText('Search, dedupe and crawl per keyword')).toBeInTheDocument();
  });

  it('spells out every step status as text, not only as a colour', () => {
    renderSteps('failed');

    expect(screen.getAllByRole('listitem').map(item => within(item).getByText(/^(Pending|In progress|Done|Failed)$/u).textContent))
      .toStrictEqual(['Done', 'Failed', 'Pending']);
  });
});
