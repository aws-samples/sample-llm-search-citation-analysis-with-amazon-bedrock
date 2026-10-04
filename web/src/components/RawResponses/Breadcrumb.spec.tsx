import {
  render, screen, fireEvent 
} from '@testing-library/react';
import {
  describe, it, expect, vi 
} from 'vitest';
import type { ComponentProps } from 'react';
import { Breadcrumb } from './Breadcrumb';

/** Renders the breadcrumb at `path`; returns its `onNavigate` spy. */
function renderBreadcrumb(path: string[], rootLabel?: ComponentProps<typeof Breadcrumb>['rootLabel']) {
  const onNavigate = vi.fn();
  render(<Breadcrumb path={path} onNavigate={onNavigate} rootLabel={rootLabel} />);
  return onNavigate;
}

describe('Breadcrumb', () => {
  it('renders root label', () => {
    renderBreadcrumb([]);

    expect(screen.getByText('raw-responses')).toBeInTheDocument();
  });

  it('renders custom root label', () => {
    renderBreadcrumb([], 'custom-root');

    expect(screen.getByText('custom-root')).toBeInTheDocument();
  });

  it('renders path segments', () => {
    renderBreadcrumb(['folder1', 'folder2']);

    expect(screen.getByText('folder1')).toBeInTheDocument();
    expect(screen.getByText('folder2')).toBeInTheDocument();
  });

  it('calls onNavigate with -1 when root clicked', () => {
    const onNavigate = renderBreadcrumb(['folder1']);

    fireEvent.click(screen.getByText('raw-responses'));
    expect(onNavigate).toHaveBeenCalledWith(-1);
  });

  it('calls onNavigate with correct index when segment clicked', () => {
    const onNavigate = renderBreadcrumb(['folder1', 'folder2']);

    fireEvent.click(screen.getByText('folder1'));
    expect(onNavigate).toHaveBeenCalledWith(0);
  });
});
