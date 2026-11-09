import {
  describe, expect, it
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { TopSourcesSection } from './TopSourcesSection';
import { sectionPlaceholderCases } from '../../layout/sectionGate-fixtures';

describe('TopSourcesSection', () => {
  it.each(sectionPlaceholderCases('Loading citation sources…', 'Failed to load citation gaps'))('shows the $name under the Top sources title', ({
    state, text
  }) => {
    render(<TopSourcesSection gaps={null} mentions={null} {...state} />);

    expect(screen.getByRole('heading', { name: 'Top sources' })).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('renders nothing once settled without citation gaps', () => {
    const { container } = render(<TopSourcesSection gaps={null} mentions={null} loading={false} error={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});
