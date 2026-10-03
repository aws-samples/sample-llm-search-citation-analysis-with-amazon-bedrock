import {
  render, screen, fireEvent 
} from '@testing-library/react';
import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import { AboutModal } from './AboutModal';

vi.mock('./AboutTab', () => ({AboutTab: () => <div>About Content</div>}));

vi.mock('./ArchitectureTab', () => ({ArchitectureTab: () => <div>Architecture Content</div>}));

vi.mock('./LicensesTab', () => ({LicensesTab: () => <div>Licenses Content</div>}));

vi.mock('./VersionTab', () => ({VersionTab: () => <div>Version Content</div>}));

describe('AboutModal', () => {
  const mockOnClose = vi.fn();
  const renderOpenAboutModal = () => render(<AboutModal isOpen={true} onClose={mockOnClose} />);

  beforeEach(() => {
    mockOnClose.mockClear();
  });

  it('renders nothing when closed', () => {
    render(<AboutModal isOpen={false} onClose={mockOnClose} />);
    expect(screen.queryByText('Citation Analysis System')).not.toBeInTheDocument();
  });

  it('renders modal when open', () => {
    renderOpenAboutModal();
    expect(screen.getByText('Citation Analysis System')).toBeInTheDocument();
  });

  it('calls onClose when the labelled close button is clicked', () => {
    renderOpenAboutModal();

    fireEvent.click(screen.getByLabelText('Close modal'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('shows About tab content by default', () => {
    renderOpenAboutModal();
    expect(screen.getByText('About Content')).toBeInTheDocument();
  });

  it.each([
    {
      tab: 'Architecture',
      content: 'Architecture Content',
    },
    {
      tab: 'Open Source',
      content: 'Licenses Content',
    },
    {
      tab: 'Version',
      content: 'Version Content',
    },
  ])('shows $tab tab content when $tab tab clicked', ({
    tab, content
  }) => {
    renderOpenAboutModal();
    fireEvent.click(screen.getByText(tab));
    expect(screen.getByText(content)).toBeInTheDocument();
  });
});