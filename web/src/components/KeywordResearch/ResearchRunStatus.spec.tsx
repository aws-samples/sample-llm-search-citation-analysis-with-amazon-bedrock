import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { ResearchRunStatus } from './ResearchRunStatus';
import { buildJob } from '../../hooks/useKeywordResearch-fixtures';

vi.mock('./ResearchProgress', () => ({ ResearchProgress: vi.fn(({ job }: { job: { id: string } }) => <p>Progress of {job.id}</p>) }));

describe('ResearchRunStatus', () => {
  it('shows the progress of a followed run of its own type', () => {
    render(<ResearchRunStatus jobType="expansion" loading={false} error={null} activeJob={buildJob({ type: 'expansion' })} onRetry={vi.fn()} />);

    expect(screen.getByText('Progress of job-1')).toBeInTheDocument();
  });

  it('shows no progress for a run of another type', () => {
    render(<ResearchRunStatus jobType="competitor" loading={false} error={null} activeJob={buildJob({ type: 'expansion' })} onRetry={vi.fn()} />);

    expect(screen.queryByText('Progress of job-1')).not.toBeInTheDocument();
  });

  it('shows the run error', () => {
    render(<ResearchRunStatus jobType="expansion" loading={false} error="Research failed" activeJob={null} onRetry={vi.fn()} />);

    expect(screen.getByText('Research failed')).toBeInTheDocument();
  });

  it('renders nothing without a followed run or an error', () => {
    const { container } = render(<ResearchRunStatus jobType="expansion" loading={false} error={null} activeJob={null} onRetry={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });
});
