import {
  describe, expect, it
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { ComputingState } from './ComputingState';

describe('ComputingState', () => {
  it('announces that the complete figures are being computed', () => {
    render(<ComputingState />);

    expect(screen.getByRole('status')).toHaveTextContent('Computing the complete figures for every keyword of this scope…');
  });

  it('names the subject being computed', () => {
    render(<ComputingState subject="brand mentions" />);

    expect(screen.getByRole('status')).toHaveTextContent('Computing the complete brand mentions for every keyword of this scope…');
  });

  it('marks the region busy while the job runs', () => {
    render(<ComputingState />);

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders the given skeleton in place of the default lines', () => {
    render(<ComputingState><div data-testid="table-skeleton" /></ComputingState>);

    expect(screen.getByTestId('table-skeleton')).toBeInTheDocument();
  });
});
