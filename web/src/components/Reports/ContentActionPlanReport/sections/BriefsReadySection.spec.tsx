import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { BriefsReadySection } from './BriefsReadySection';
import {
  buildBrief, incompleteMetadataWarning
} from './BriefsReadySection-fixtures';

describe('BriefsReadySection', () => {
  it('shows only generated briefs when history contains other statuses', () => {
    render(
      <BriefsReadySection
        history={[
          buildBrief('h1', 'Generated brief', 'generated'),
          buildBrief('h2', 'Pending brief', 'pending'),
          buildBrief('h3', 'Failed brief', 'failed'),
        ]}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText('Generated brief')).toBeInTheDocument();
    expect(screen.queryByText('Pending brief')).not.toBeInTheDocument();
    expect(screen.queryByText('Failed brief')).not.toBeInTheDocument();
  });

  it('shows eight briefs when more than eight are generated', () => {
    const briefs = Array.from({ length: 12 }, (_, index) =>
      buildBrief(`h${index}`, `Brief ${index}`, 'generated'),
    );
    render(<BriefsReadySection history={briefs} loading={false} error={null} />);
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(8);
  });

  it('shows four key points when a brief contains more than four', () => {
    render(
      <BriefsReadySection
        history={[buildBrief('h1', 'Brief A', 'generated')]}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('shows the trimmed idea title when the generated title is whitespace', () => {
    render(
      <BriefsReadySection
        history={[buildBrief('h1', 'Unused', 'generated', {
          generatedTitle: '   ',
          ideaTitle: '  Planned family guide  ',
        })]}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByRole('heading', {
      level: 3,
      name: 'Planned family guide',
    })).toBeInTheDocument();
  });

  it('shows the trimmed keyword when generated and idea titles are blank', () => {
    render(
      <BriefsReadySection
        history={[buildBrief('h1', 'Unused', 'generated', {
          generatedTitle: '',
          ideaTitle: '  ',
          keyword: '  family hotels malaga  ',
        })]}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByRole('heading', {
      level: 3,
      name: 'family hotels malaga',
    })).toBeInTheDocument();
  });

  it('shows the exact incomplete-draft warning when generated metadata is missing', () => {
    render(
      <BriefsReadySection
        history={[buildBrief(
          'h1',
          'Brief A',
          'generated',
          { contentWarning: incompleteMetadataWarning }
        )]}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      /^Needs review: This draft is usable, but some generated metadata is incomplete\. Missing: title, meta description\.$/,
    );
  });

  it('shows the empty state when no briefs are generated', () => {
    render(
      <BriefsReadySection
        history={[buildBrief('h1', 'Pending', 'pending')]}
        loading={false}
        error={null}
      />,
    );
    expect(
      screen.getByText(/No generated briefs are waiting/i),
    ).toBeInTheDocument();
  });

  it('shows the loading placeholder when loading is true', () => {
    render(<BriefsReadySection history={[]} loading error={null} />);
    expect(screen.getByText(/Loading content history/i)).toBeInTheDocument();
  });

  it('shows the error placeholder when an error is set', () => {
    render(<BriefsReadySection history={[]} loading={false} error="Backend down" />);
    expect(screen.getByText(/Backend down/i)).toBeInTheDocument();
  });
});
