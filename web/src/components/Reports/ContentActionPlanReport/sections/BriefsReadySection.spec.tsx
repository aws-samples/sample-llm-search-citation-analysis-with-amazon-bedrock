import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import type { ContentStudioHistory } from '../../../../types';
import type { SectionFetchState } from '../../layout';
import { incompleteMetadataWarning } from '../../../ContentStudio/ContentStudioHistory-fixtures';
import { BriefsReadySection } from './BriefsReadySection';
import {
  buildBrief, fetchPlaceholderCases
} from './ContentPlanSectionProps-fixtures';

function renderBriefs(
  history: ReadonlyArray<ContentStudioHistory>,
  state: SectionFetchState = {
    loading: false,
    error: null,
  },
) {
  return render(<BriefsReadySection history={history} {...state} />);
}

describe('BriefsReadySection', () => {
  it('shows only generated briefs when history contains other statuses', () => {
    renderBriefs([
      buildBrief('Generated brief'),
      buildBrief('Pending brief', { status: 'pending' }),
      buildBrief('Failed brief', { status: 'failed' }),
    ]);
    expect(screen.getByText('Generated brief')).toBeInTheDocument();
    expect(screen.queryByText('Pending brief')).not.toBeInTheDocument();
    expect(screen.queryByText('Failed brief')).not.toBeInTheDocument();
  });

  it('shows eight briefs when more than eight are generated', () => {
    renderBriefs(Array.from({ length: 12 }, (_, index) => buildBrief(`Brief ${index}`)));
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(8);
  });

  it('shows four key points when a brief contains more than four', () => {
    renderBriefs([buildBrief('Brief A', { generated_content: { key_points: ['Point A', 'Point B', 'Point C', 'Point D', 'Point E'] } })]);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it.each([
    {
      name: 'the trimmed idea title when the generated title is whitespace',
      overrides: {
        generated_content: { title: '   ' },
        idea_title: '  Planned family guide  ',
      },
      heading: 'Planned family guide',
    },
    {
      name: 'the trimmed keyword when generated and idea titles are blank',
      overrides: {
        generated_content: { title: '' },
        idea_title: '  ',
        keyword: '  family hotels malaga  ',
      },
      heading: 'family hotels malaga',
    },
  ])('shows $name', ({
    overrides, heading
  }) => {
    renderBriefs([buildBrief('Unused', overrides)]);
    expect(screen.getByRole('heading', {
      level: 3,
      name: heading,
    })).toBeInTheDocument();
  });

  it('shows the exact incomplete-draft warning when generated metadata is missing', () => {
    renderBriefs([buildBrief('Brief A', { content_warning: incompleteMetadataWarning })]);
    expect(screen.getByRole('status')).toHaveTextContent(
      /^Needs review: This draft is usable, but some generated metadata is incomplete\. Missing: title, meta description\.$/,
    );
  });

  it('shows the empty state when no briefs are generated', () => {
    renderBriefs([buildBrief('Pending', { status: 'pending' })]);
    expect(
      screen.getByText(/No generated briefs are waiting/i),
    ).toBeInTheDocument();
  });

  it.each(fetchPlaceholderCases(/Loading content history/i))('shows the $name', ({
    state, text
  }) => {
    renderBriefs([], state);
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});
