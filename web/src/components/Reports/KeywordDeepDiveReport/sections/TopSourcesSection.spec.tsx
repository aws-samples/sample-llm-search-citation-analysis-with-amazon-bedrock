import {
  describe, expect, it
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { TopSourcesSection } from './TopSourcesSection';

describe('TopSourcesSection', () => {
  it('shows the loading message under the Top sources title while the sources load', () => {
    render(<TopSourcesSection gaps={null} mentions={null} loading error={null} />);

    expect(screen.getByRole('heading', { name: 'Top sources' })).toBeInTheDocument();
    expect(screen.getByText('Loading citation sources…')).toBeInTheDocument();
  });

  it('shows the load error under the Top sources title', () => {
    render(<TopSourcesSection gaps={null} mentions={null} loading={false} error="Failed to load citation gaps" />);

    expect(screen.getByRole('heading', { name: 'Top sources' })).toBeInTheDocument();
    expect(screen.getByText('Failed to load citation gaps')).toBeInTheDocument();
  });

  it('renders nothing once settled without citation gaps', () => {
    const { container } = render(<TopSourcesSection gaps={null} mentions={null} loading={false} error={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});
