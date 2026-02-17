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

describe('AboutModal', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    mockOnClose.mockClear();
  });

  it('renders nothing when closed', () => {
    render(<AboutModal isOpen={false} onClose={mockOnClose} />);
    expect(screen.queryByText('Citation Analysis System')).not.toBeInTheDocument();
  });

  it('renders modal when open', () => {
    render(<AboutModal isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Citation Analysis System')).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', () => {
    render(<AboutModal isOpen={true} onClose={mockOnClose} />);
    // Close button is in the header, contains an SVG X icon
    const header = screen.getByText('Citation Analysis System').parentElement;
    const closeButton = header?.querySelector('button');
    fireEvent.click(closeButton as HTMLElement);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('shows About tab content by default', () => {
    render(<AboutModal isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('About Content')).toBeInTheDocument();
  });

  it('shows Architecture tab content when Architecture tab clicked', () => {
    render(<AboutModal isOpen={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByText('Architecture'));
    expect(screen.getByText('Architecture Content')).toBeInTheDocument();
  });

  it('shows Open Source tab content when Open Source tab clicked', () => {
    render(<AboutModal isOpen={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByText('Open Source'));
    expect(screen.getByText('Licenses Content')).toBeInTheDocument();
  });
});