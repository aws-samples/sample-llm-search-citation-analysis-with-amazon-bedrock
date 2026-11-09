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

      expect(getKeywordStepElement().getByText(/^10 of 20 keywords done/u)).toBeInTheDocument();
    }
  );

  it('shows the failed keyword count when keywords failed', () => {
    renderSteps('running', buildKeywordProgress({ keywords_failed: 3 }));

    expect(getKeywordStepElement().getByText('12 of 20 keywords done · 3 failed')).toBeInTheDocument();
  });

  it('omits the failed keyword count when no keyword failed', () => {
    renderSteps('running', buildKeywordProgress({
      keywords_succeeded: 10,
      keywords_failed: 0 
    }));

    expect(getKeywordStepElement().getByText('10 of 20 keywords done')).toBeInTheDocument();
    expect(screen.queryByText(/failed$/u)).not.toBeInTheDocument();
  });

  it('shows no keyword count when the step has no counts yet', () => {
    renderSteps('running', null);

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('names the steps in plain words, not by their workflow state ids', () => {
    renderSteps('running');

    expect(screen.getAllByRole('listitem').map(item => item.querySelector('p')?.textContent))
      .toStrictEqual(['Prepare keywords', 'Ask AI engines and crawl sources', 'Write summary']);
    expect(screen.queryByText('ProcessKeywords')).not.toBeInTheDocument();
  });

  it('shows the keywords done as a progress bar', () => {
    renderSteps('running');

    expect(screen.getByRole('progressbar', { name: 'Keywords done' })).toHaveProperty('value', 10);
  });

  it('spells out every step status as text, not only as a colour', () => {
    renderSteps('failed');

    expect(screen.getAllByRole('listitem').map(item => within(item).getByText(/^(Pending|In progress|Done|Failed)$/u).textContent))
      .toStrictEqual(['Done', 'Failed', 'Pending']);
  });
});
