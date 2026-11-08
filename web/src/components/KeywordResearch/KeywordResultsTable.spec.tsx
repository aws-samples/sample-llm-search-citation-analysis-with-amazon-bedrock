import {
  describe, expect, it, vi
} from 'vitest';
import {
  fireEvent, render, screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KeywordResultsTable } from './KeywordResultsTable';
import { expansionKeywordFixtures } from './expandedKeyword-fixtures';
import {
  chooseExportFormat, mockStartExport
} from '../../test/exportsApiMock';

vi.mock('../../api/exports', () => import('../../test/exportsApiMock'));

const JOB_ID = 'research-coruna';

describe('KeywordResultsTable', () => {
  it('heads the columns Keyword, Intent, Competition, Relevance and Actions', () => {
    render(<KeywordResultsTable keywords={expansionKeywordFixtures} jobId={JOB_ID} title="Expanded keywords" />);

    expect(within(screen.getAllByRole('rowgroup')[0]).getAllByRole('columnheader').map((header) => header.textContent))
      .toStrictEqual(['Keyword', 'Intent', 'Competition', 'Relevance', 'Actions']);
  });

  it('ticks only the selected keywords', () => {
    render(<KeywordResultsTable keywords={expansionKeywordFixtures} jobId={JOB_ID} title="Expanded keywords" selectable selected={new Set(['luxury hotels'])} onToggle={vi.fn()} />);

    expect(screen.getByRole('checkbox', { name: 'Select luxury hotels' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select beach resorts' })).not.toBeChecked();
  });

  it('leaves every keyword unticked without a selection', () => {
    render(<KeywordResultsTable keywords={expansionKeywordFixtures} jobId={JOB_ID} title="Expanded keywords" selectable />);

    expect(screen.getByRole('checkbox', { name: 'Select luxury hotels' })).not.toBeChecked();
  });

  it('ignores a tick when no onToggle handler is given', async () => {
    render(<KeywordResultsTable keywords={expansionKeywordFixtures} jobId={JOB_ID} title="Expanded keywords" selectable />);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select luxury hotels' }));

    expect(screen.getByRole('checkbox', { name: 'Select luxury hotels' })).not.toBeChecked();
  });

  it('hands the toggled keyword to onToggle', async () => {
    const onToggle = vi.fn();
    render(<KeywordResultsTable keywords={expansionKeywordFixtures} jobId={JOB_ID} title="Expanded keywords" selectable selected={new Set()} onToggle={onToggle} />);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select beach resorts' }));

    expect(onToggle).toHaveBeenCalledWith('beach resorts');
  });

  it('copies a keyword to the clipboard with its copy button', async () => {
    const user = userEvent.setup();
    render(<KeywordResultsTable keywords={expansionKeywordFixtures} jobId={JOB_ID} title="Expanded keywords" />);

    await user.click(screen.getAllByTitle('Copy keyword')[0]);

    await expect(navigator.clipboard.readText()).resolves.toBe('luxury hotels');
  });

  it('exports every keyword of the research job', async () => {
    render(<KeywordResultsTable keywords={expansionKeywordFixtures} jobId={JOB_ID} title="Expanded keywords" />);

    await chooseExportFormat('xlsx');

    expect(mockStartExport).toHaveBeenCalledWith({
      view: 'keyword-research',
      params: { id: JOB_ID },
      format: 'xlsx',
    });
  });

  it('exports the keywords of the chosen intent only', async () => {
    render(<KeywordResultsTable keywords={expansionKeywordFixtures} jobId={JOB_ID} title="Expanded keywords" />);
    fireEvent.change(screen.getByDisplayValue('All Intents'), { target: { value: 'commercial' } });

    await chooseExportFormat('csv');

    expect(mockStartExport).toHaveBeenCalledWith({
      view: 'keyword-research',
      params: {
        id: JOB_ID,
        intent: 'commercial',
      },
      format: 'csv',
    });
  });
});
