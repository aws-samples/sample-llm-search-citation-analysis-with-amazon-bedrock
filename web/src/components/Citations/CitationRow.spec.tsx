import {
  render, screen, fireEvent 
} from '@testing-library/react';
import {
  describe, it, expect, vi 
} from 'vitest';
import { CitationRow } from './CitationRow';
import type { TopUrl } from '../../types';

const mockCitation: TopUrl = {
  url: 'https://example.com/test',
  citation_count: 5,
  keyword_count: 2
};

const mockBreakdown = [
  {
    keyword: 'test keyword',
    provider: 'openai',
    timestamp: '2024-01-01' 
  }
];

describe('CitationRow', () => {
  const defaultProps = {
    citation: mockCitation,
    idx: 0,
    globalRank: 1,
    isExpanded: false,
    breakdown: mockBreakdown,
    isLoading: false,
    onToggleRow: vi.fn(),
    onViewDetails: vi.fn(),
    onKeywordClick: vi.fn(),
    getDomain: vi.fn(() => 'example.com')
  };

  const renderInTable = (ui: React.ReactElement) => render(<table><tbody>{ui}</tbody></table>);

  it('displays rank, URL, and domain from citation data', () => {
    renderInTable(<CitationRow {...defaultProps} />);
    
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('https://example.com/test')).toBeInTheDocument();
    expect(screen.getByText('example.com')).toBeInTheDocument();
  });

  it('displays keyword count and citation count from citation data', () => {
    renderInTable(<CitationRow {...defaultProps} />);
    
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('calls onToggleRow when row clicked', () => {
    const onToggleRow = vi.fn();
    renderInTable(<CitationRow {...defaultProps} onToggleRow={onToggleRow} />);
    
    // Click on the rank cell (not the URL which has stopPropagation)
    fireEvent.click(screen.getByText('1'));
    expect(onToggleRow).toHaveBeenCalledWith(0, 'https://example.com/test');
  });

  it('calls onViewDetails when View button clicked', () => {
    const onViewDetails = vi.fn();
    renderInTable(<CitationRow {...defaultProps} onViewDetails={onViewDetails} />);
    
    fireEvent.click(screen.getByText('View'));
    expect(onViewDetails).toHaveBeenCalledWith('https://example.com/test', expect.any(Object));
  });

  it('shows expanded content when isExpanded is true', () => {
    renderInTable(<CitationRow {...defaultProps} isExpanded={true} />);
    
    expect(screen.getByText('Ranking for 1 keyword')).toBeInTheDocument();
    expect(screen.getByText('test keyword')).toBeInTheDocument();
  });

  it('shows loading state when isLoading is true', () => {
    renderInTable(<CitationRow {...defaultProps} isExpanded={true} isLoading={true} />);
    
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });
});