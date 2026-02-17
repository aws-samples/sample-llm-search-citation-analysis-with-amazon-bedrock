import {
  render, screen, fireEvent 
} from '@testing-library/react';
import {
  describe, it, expect, vi 
} from 'vitest';
import { CitationTableHeader } from './CitationTableHeader';

describe('CitationTableHeader', () => {
  const renderInTable = (ui: React.ReactElement) => render(<table>{ui}</table>);

  it('displays #, URL, and Domain column headers', () => {
    const setSortBy = vi.fn();
    renderInTable(<CitationTableHeader sortBy="citations" setSortBy={setSortBy} />);
    
    expect(screen.getByText('#')).toBeInTheDocument();
    expect(screen.getByText('URL')).toBeInTheDocument();
    expect(screen.getByText('Domain')).toBeInTheDocument();
  });

  it('displays Keywords and Citations column headers', () => {
    const setSortBy = vi.fn();
    renderInTable(<CitationTableHeader sortBy="citations" setSortBy={setSortBy} />);
    
    expect(screen.getByText('Keywords')).toBeInTheDocument();
    expect(screen.getByText('Citations')).toBeInTheDocument();
  });

  it('calls setSortBy with keywords when Keywords header clicked', () => {
    const setSortBy = vi.fn();
    renderInTable(<CitationTableHeader sortBy="citations" setSortBy={setSortBy} />);
    
    fireEvent.click(screen.getByText('Keywords'));
    expect(setSortBy).toHaveBeenCalledWith('keywords');
  });

  it('calls setSortBy with citations when Citations header clicked', () => {
    const setSortBy = vi.fn();
    renderInTable(<CitationTableHeader sortBy="keywords" setSortBy={setSortBy} />);
    
    fireEvent.click(screen.getByText('Citations'));
    expect(setSortBy).toHaveBeenCalledWith('citations');
  });

  it('shows sort indicator for active sort', () => {
    const setSortBy = vi.fn();
    renderInTable(<CitationTableHeader sortBy="keywords" setSortBy={setSortBy} />);
    
    const keywordsHeader = screen.getByText('Keywords').closest('th');
    expect(keywordsHeader?.querySelector('svg')).toBeInTheDocument();
  });
});