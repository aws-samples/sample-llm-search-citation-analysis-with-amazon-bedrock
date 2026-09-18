import {
  describe, it, expect, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResearchProgress } from './ResearchProgress';
import {
  buildJob, buildStep
} from '../../hooks/useKeywordResearch-fixtures';

const runningJob = buildJob({
  status: 'running',
  keyword_count: 12,
  steps_total: 3,
  steps_done: 1,
  steps: [
    buildStep('perplexity', { keyword_count: 12 }),
    buildStep('openai', { status: 'running' }),
    buildStep('gemini', { status: 'pending' }),
  ],
});

const partialJob = buildJob({
  status: 'partial',
  keyword_count: 12,
  steps_total: 2,
  steps_done: 2,
  steps_failed: 1,
  error_message: 'perplexity: 401 invalid_api_key',
  steps: [
    buildStep('perplexity', {
      status: 'failed',
      keyword_count: 0,
      error_message: '401 invalid_api_key' 
    }),
    buildStep('openai', { keyword_count: 12 }),
  ],
});

describe('ResearchProgress', () => {
  it('renders nothing for a legacy job without a status', () => {
    const { container } = render(<ResearchProgress job={buildJob({ status: undefined })} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('reports how many providers have finished while running', () => {
    render(<ResearchProgress job={runningJob} />);

    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('1 of 3 providers finished')).toBeInTheDocument();
    expect(screen.getByText('· 12 keywords so far')).toBeInTheDocument();
  });

  it('lists every provider step with its own status', () => {
    render(<ResearchProgress job={runningJob} />);

    expect(screen.getByText('Perplexity')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('Querying')).toBeInTheDocument();
    expect(screen.getByText('Waiting')).toBeInTheDocument();
  });

  it('says it is planning while no step exists yet', () => {
    render(<ResearchProgress job={buildJob({ status: 'pending' })} />);

    expect(screen.getByText('Planning providers…')).toBeInTheDocument();
  });

  it('shows the failed step error and the job error on a partial job', () => {
    render(<ResearchProgress job={partialJob} />);

    expect(screen.getByText('Partial')).toBeInTheDocument();
    expect(screen.getByText('401 invalid_api_key')).toBeInTheDocument();
    expect(screen.getByText('perplexity: 401 invalid_api_key')).toBeInTheDocument();
  });

  it('offers a retry on a partial job and hands back the job', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ResearchProgress job={partialJob} onRetry={onRetry} />);

    await user.click(screen.getByRole('button', { name: 'Retry failed providers' }));

    expect(onRetry).toHaveBeenCalledWith(partialJob);
  });

  it('hides the retry while a retry is already in flight', () => {
    render(<ResearchProgress job={partialJob} onRetry={vi.fn()} retrying />);

    expect(screen.queryByRole('button', { name: 'Retry failed providers' })).not.toBeInTheDocument();
  });

  it('offers no retry on a running or completed job', () => {
    const { rerender } = render(<ResearchProgress job={runningJob} onRetry={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Retry failed providers' })).not.toBeInTheDocument();

    rerender(<ResearchProgress job={buildJob({ status: 'completed' })} onRetry={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Retry failed providers' })).not.toBeInTheDocument();
  });
});
