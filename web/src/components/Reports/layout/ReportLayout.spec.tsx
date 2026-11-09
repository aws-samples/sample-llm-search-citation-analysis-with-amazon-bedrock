import {
  describe, it, expect
} from 'vitest';
import {
  render, screen, within
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ReportLayout } from './ReportLayout';

function renderLayout(layout: ReactNode, path = '/reports/benchmark') {
  return render(<MemoryRouter initialEntries={[path]}>{layout}</MemoryRouter>);
}

/** A "Demo" report with one paragraph, at `path`. */
function renderDemoLayout(path?: string) {
  return renderLayout(
    <ReportLayout title="Demo">
      <p>body</p>
    </ReportLayout>,
    path,
  );
}

describe('ReportLayout', () => {
  it('renders the report title as an H1', () => {
    renderLayout(
      <ReportLayout title="Keyword Deep Dive: best running shoes">
        <p>body</p>
      </ReportLayout>,
    );
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Keyword Deep Dive: best running shoes',
      }),
    ).toBeInTheDocument();
  });

  it('renders the optional subtitle', () => {
    renderLayout(
      <ReportLayout title="Demo" subtitle="Some description">
        <p>body</p>
      </ReportLayout>,
    );
    expect(screen.getByText('Some description')).toBeInTheDocument();
  });

  it('renders a generated-at timestamp so the printout is self-identifying', () => {
    renderDemoLayout();
    expect(screen.getByText(/Generated /)).toBeInTheDocument();
  });

  it('renders body children', () => {
    renderLayout(
      <ReportLayout title="Demo">
        <p data-testid="body">body</p>
      </ReportLayout>,
    );
    expect(screen.getByTestId('body')).toBeInTheDocument();
  });

  it('marks the actions slot with print-hidden so screen-only controls drop out of the PDF', () => {
    renderLayout(
      <ReportLayout
        title="Demo"
        actions={<button data-testid="filter">Filter</button>}
      >
        <p>body</p>
      </ReportLayout>,
    );
    expect(screen.getByTestId('filter').closest('.print-hidden')).not.toBeNull();
  });

  it('leads back to the Reports page from a breadcrumb naming the report', () => {
    renderLayout(
      <ReportLayout title="Competitor Gap — Adidas" name="Competitor Gap">
        <p>body</p>
      </ReportLayout>,
    );
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(breadcrumb).getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/reports');
    expect(within(breadcrumb).getByText('Competitor Gap')).toHaveAttribute('aria-current', 'page');
  });

  it('opens the same view in a print tab from Save as PDF, keeping its query', () => {
    renderDemoLayout('/reports/benchmark?group=g1&days=90');
    const link = screen.getByRole('link', { name: 'Save as PDF (opens in a new tab)' });
    expect(link).toHaveAttribute('href', '/reports/benchmark?group=g1&days=90&print=1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.closest('.print-hidden')).not.toBeNull();
  });

  it('puts page actions next to Save as PDF', () => {
    renderLayout(
      <ReportLayout title="Demo" headerActions={<button type="button">Edit report</button>}>
        <p>body</p>
      </ReportLayout>,
    );
    const pdf = screen.getByRole('link', { name: 'Save as PDF (opens in a new tab)' });
    expect(pdf.parentElement).toContainElement(screen.getByRole('button', { name: 'Edit report' }));
  });
});
