import {
  describe, expect, it, vi
} from 'vitest';
import {
  fireEvent, render, screen, waitFor
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ApiRequestError } from '../../infrastructure';
import { EXPORTS_CONTEXT } from '../../hooks/useExports';
import type { ExportsCenter } from '../../hooks/useExports';
import { buildExportSummary } from '../../types/domain/exports-fixtures';
import { buildExportsCenter } from './ExportsView-fixtures';
import { ExportsView } from './ExportsView';
import { ExportsBadge } from './ExportsBadge';
import { ExportToasts } from './ExportToasts';

const READY = buildExportSummary({
  export_id: 'e-ready',
  status: 'ready',
  rows: 41237,
  bytes: 3_355_443,
});
const RUNNING = buildExportSummary({
  export_id: 'e-running',
  view: 'alerts',
  params: { status: 'open' },
});

function renderWithCenter(center: ExportsCenter, children: ReactNode) {
  return render(
    <MemoryRouter>
      <EXPORTS_CONTEXT.Provider value={center}>{children}</EXPORTS_CONTEXT.Provider>
    </MemoryRouter>,
  );
}

describe('ExportsView', () => {
  it('lists an export with what it holds, its status and size', () => {
    renderWithCenter(buildExportsCenter({ exports: [READY] }), <ExportsView />);

    const row = screen.getAllByRole('row')[1];
    expect(row).toHaveTextContent('Citationsgroup_id: group-coruna · market_id: es-esXLSXReady41,237 rows, 3.2 MB');
  });

  it('says how many XLSX cells were cut to Excel\'s limit', () => {
    const cut = buildExportSummary({
      status: 'ready',
      truncated_cells: 2 
    });
    renderWithCenter(buildExportsCenter({ exports: [cut] }), <ExportsView />);

    expect(screen.getAllByRole('row')[1]).toHaveTextContent('2 cells cut to Excel\'s 32,767-character limit; the CSV export has the full text');
  });

  it('says nothing about cut cells when none was cut', () => {
    renderWithCenter(buildExportsCenter({ exports: [READY] }), <ExportsView />);

    expect(screen.getAllByRole('row')[1]).not.toHaveTextContent('character limit');
  });

  it('downloads a ready export through the center', async () => {
    const center = buildExportsCenter({ exports: [READY] });
    renderWithCenter(center, <ExportsView />);

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled());
    expect(center.download).toHaveBeenCalledWith('e-ready');
  });

  it('cancels a running export through the center', async () => {
    const center = buildExportsCenter({ exports: [RUNNING] });
    renderWithCenter(center, <ExportsView />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled());
    expect(center.remove).toHaveBeenCalledWith('e-running');
  });

  it('shows why a download failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const center = buildExportsCenter({
      exports: [READY],
      download: vi.fn(() => Promise.reject(new ApiRequestError('The export has no download link yet'))),
    });
    renderWithCenter(center, <ExportsView />);

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('An unexpected error occurred');
  });

  it('offers no download for a running export', () => {
    renderWithCenter(buildExportsCenter({ exports: [RUNNING] }), <ExportsView />);

    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
  });

  it('marks finished exports seen when opened with unseen ones', () => {
    const center = buildExportsCenter({
      exports: [READY],
      unseenCount: 1,
    });
    renderWithCenter(center, <ExportsView />);

    expect(center.markAllSeen).toHaveBeenCalledWith();
  });

  it('loads older exports when there is a next page', () => {
    const center = buildExportsCenter({
      exports: [READY],
      nextToken: 'p2',
    });
    renderWithCenter(center, <ExportsView />);

    fireEvent.click(screen.getByRole('button', { name: 'Load older exports' }));

    expect(center.loadMore).toHaveBeenCalledWith();
  });

  it('says there are no exports yet', () => {
    renderWithCenter(buildExportsCenter(), <ExportsView />);

    expect(screen.getByText('No exports yet. Use Export all on any view to export its full data.')).toBeInTheDocument();
  });

  it('asks for browser notifications only when the button is clicked', async () => {
    const requestPermission = vi.fn(() => Promise.resolve('granted'));
    vi.stubGlobal('Notification', {
      permission: 'default',
      requestPermission,
    });
    renderWithCenter(buildExportsCenter(), <ExportsView />);
    expect(requestPermission).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Notify me in the browser' }));

    expect(await screen.findByText(/^Browser notifications are on/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

describe('ExportsBadge', () => {
  it('shows the count of finished exports not seen', () => {
    renderWithCenter(buildExportsCenter({ unseenCount: 2 }), <ExportsBadge />);

    expect(screen.getByRole('link', { name: 'Exports, 2 finished not seen' })).toHaveAttribute('href', '/exports');
  });

  it('shows no count when every finished export was seen', () => {
    renderWithCenter(buildExportsCenter(), <ExportsBadge />);

    expect(screen.getByRole('link', { name: 'Exports' })).not.toHaveTextContent(/\d/);
  });
});

describe('ExportToasts', () => {
  it('links a toast to the Exports page', () => {
    renderWithCenter(buildExportsCenter(), <ExportToasts toasts={[{
      id: 't1',
      tone: 'success',
      message: 'Citations export is ready',
    }]} onDismiss={vi.fn()} />);

    expect(screen.getByRole('link', { name: 'Open Exports' })).toHaveAttribute('href', '/exports');
  });

  it('dismisses a toast after 8 seconds', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    renderWithCenter(buildExportsCenter(), <ExportToasts toasts={[{
      id: 't1',
      tone: 'info',
      message: 'Export started',
    }]} onDismiss={onDismiss} />);

    vi.advanceTimersByTime(8_000);

    expect(onDismiss).toHaveBeenCalledWith('t1');
    vi.useRealTimers();
  });
});
