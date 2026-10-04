import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KeywordResultsTable } from './KeywordResultsTable';
import { expansionKeywordFixtures } from './expandedKeyword-fixtures';
import { exportResearchKeywords } from './researchExport';

vi.mock('./researchExport', () => ({ exportResearchKeywords: vi.fn(() => Promise.resolve()) }));

describe('KeywordResultsTable', () => {
  it('heads the columns Keyword, Intent, Competition, Relevance and Actions', () => {
    render(<KeywordResultsTable keywords={expansionKeywordFixtures} title="Expanded keywords" />);

    expect(within(screen.getAllByRole('rowgroup')[0]).getAllByRole('columnheader').map((header) => header.textContent))
      .toStrictEqual(['Keyword', 'Intent', 'Competition', 'Relevance', 'Actions']);
  });

  it('ticks only the selected keywords', () => {
    render(<KeywordResultsTable keywords={expansionKeywordFixtures} title="Expanded keywords" selectable selected={new Set(['luxury hotels'])} onToggle={vi.fn()} />);

    expect(screen.getByRole('checkbox', { name: 'Select luxury hotels' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select beach resorts' })).not.toBeChecked();
  });

  it('leaves every keyword unticked without a selection', () => {
    render(<KeywordResultsTable keywords={expansionKeywordFixtures} title="Expanded keywords" selectable />);

    expect(screen.getByRole('checkbox', { name: 'Select luxury hotels' })).not.toBeChecked();
  });

  it('ignores a tick when no onToggle handler is given', async () => {
    render(<KeywordResultsTable keywords={expansionKeywordFixtures} title="Expanded keywords" selectable />);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select luxury hotels' }));

    expect(screen.getByRole('checkbox', { name: 'Select luxury hotels' })).not.toBeChecked();
  });

  it('hands the toggled keyword to onToggle', async () => {
    const onToggle = vi.fn();
    render(<KeywordResultsTable keywords={expansionKeywordFixtures} title="Expanded keywords" selectable selected={new Set()} onToggle={onToggle} />);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select beach resorts' }));

    expect(onToggle).toHaveBeenCalledWith('beach resorts');
  });

  it('copies a keyword to the clipboard with its copy button', async () => {
    const user = userEvent.setup();
    render(<KeywordResultsTable keywords={expansionKeywordFixtures} title="Expanded keywords" />);

    await user.click(screen.getAllByTitle('Copy keyword')[0]);

    await expect(navigator.clipboard.readText()).resolves.toBe('luxury hotels');
  });

  it('exports the shown keywords, most relevant first, under the table title', async () => {
    render(<KeywordResultsTable keywords={expansionKeywordFixtures} title="Expanded keywords" />);

    await userEvent.click(screen.getByRole('button', { name: 'Export to Excel' }));

    expect(exportResearchKeywords).toHaveBeenCalledWith(expansionKeywordFixtures, 'Expanded keywords');
  });

  it('logs a failed export under the research prefix', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const failure = new TypeError('Workbook failed');
    vi.mocked(exportResearchKeywords).mockRejectedValueOnce(failure);
    render(<KeywordResultsTable keywords={expansionKeywordFixtures} title="Expanded keywords" />);

    await userEvent.click(screen.getByRole('button', { name: 'Export to Excel' }));

    expect(consoleError).toHaveBeenCalledWith('[research] Excel export failed:', failure);
  });
});
