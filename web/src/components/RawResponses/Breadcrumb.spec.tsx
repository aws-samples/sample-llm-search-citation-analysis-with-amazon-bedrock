import {
  render, screen, fireEvent 
} from '@testing-library/react';
import {
  describe, it, expect, vi 
} from 'vitest';
import { Breadcrumb } from './Breadcrumb';

describe('Breadcrumb', () => {
  it('renders root label', () => {
    const onNavigate = vi.fn();
    render(<Breadcrumb path={[]} onNavigate={onNavigate} />);
    
    expect(screen.getByText('raw-responses')).toBeInTheDocument();
  });

  it('renders custom root label', () => {
    const onNavigate = vi.fn();
    render(<Breadcrumb path={[]} onNavigate={onNavigate} rootLabel="custom-root" />);
    
    expect(screen.getByText('custom-root')).toBeInTheDocument();
  });

  it('renders path segments', () => {
    const onNavigate = vi.fn();
    render(<Breadcrumb path={['folder1', 'folder2']} onNavigate={onNavigate} />);
    
    expect(screen.getByText('folder1')).toBeInTheDocument();
    expect(screen.getByText('folder2')).toBeInTheDocument();
  });

  it('calls onNavigate with -1 when root clicked', () => {
    const onNavigate = vi.fn();
    render(<Breadcrumb path={['folder1']} onNavigate={onNavigate} />);
    
    fireEvent.click(screen.getByText('raw-responses'));
    expect(onNavigate).toHaveBeenCalledWith(-1);
  });

  it('calls onNavigate with correct index when segment clicked', () => {
    const onNavigate = vi.fn();
    render(<Breadcrumb path={['folder1', 'folder2']} onNavigate={onNavigate} />);
    
    fireEvent.click(screen.getByText('folder1'));
    expect(onNavigate).toHaveBeenCalledWith(0);
  });
});