import {
  render, screen, fireEvent 
} from '@testing-library/react';
import {
  describe, it, expect 
} from 'vitest';
import { PaginationControls } from './PaginationControls';
import { buildProps } from './PaginationControls-fixtures';

describe('PaginationControls', () => {
  it('displays current range and total items', () => {
    render(<PaginationControls {...buildProps()} />);
    
    expect(screen.getByText('1-25 of 120')).toBeInTheDocument();
  });

  it('displays all items count when showAll is true', () => {
    render(<PaginationControls {...buildProps({ showAll: true })} />);
    
    expect(screen.getByText('All 120')).toBeInTheDocument();
  });

  it('calls onItemsPerPageChange when select value changes', () => {
    const props = buildProps();
    render(<PaginationControls {...props} />);
    
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '50' } });
    expect(props.onItemsPerPageChange).toHaveBeenCalledWith(50);
  });

  it('calls onPageChange with 1 when First button clicked', () => {
    const props = buildProps({ currentPage: 3 });
    render(<PaginationControls {...props} />);
    
    fireEvent.click(screen.getByText('First'));
    expect(props.onPageChange).toHaveBeenCalledWith(1);
  });

  it('calls onPageChange with previous page when Prev button clicked', () => {
    const props = buildProps({ currentPage: 3 });
    render(<PaginationControls {...props} />);
    
    fireEvent.click(screen.getByText('Prev'));
    expect(props.onPageChange).toHaveBeenCalledWith(2);
  });

  it('calls onPageChange with next page when Next button clicked', () => {
    const props = buildProps({ currentPage: 3 });
    render(<PaginationControls {...props} />);
    
    fireEvent.click(screen.getByText('Next'));
    expect(props.onPageChange).toHaveBeenCalledWith(4);
  });

  it('calls onPageChange with last page when Last button clicked', () => {
    const props = buildProps({ currentPage: 3 });
    render(<PaginationControls {...props} />);
    
    fireEvent.click(screen.getByText('Last'));
    expect(props.onPageChange).toHaveBeenCalledWith(5);
  });

  it('disables First and Prev buttons on first page', () => {
    render(<PaginationControls {...buildProps({ currentPage: 1 })} />);
    
    expect(screen.getByText('First')).toBeDisabled();
    expect(screen.getByText('Prev')).toBeDisabled();
  });

  it('disables Next and Last buttons on last page', () => {
    render(<PaginationControls {...buildProps({ currentPage: 5 })} />);
    
    expect(screen.getByText('Next')).toBeDisabled();
    expect(screen.getByText('Last')).toBeDisabled();
  });

  it('hides pagination buttons when only one page', () => {
    render(<PaginationControls {...buildProps({ totalPages: 1 })} />);
    
    expect(screen.queryByText('First')).not.toBeInTheDocument();
    expect(screen.queryByText('Prev')).not.toBeInTheDocument();
  });

  it('displays current page and total pages', () => {
    render(<PaginationControls {...buildProps({
      currentPage: 3,
      totalPages: 5 
    })} />);
    
    expect(screen.getByText('3/5')).toBeInTheDocument();
  });
});
