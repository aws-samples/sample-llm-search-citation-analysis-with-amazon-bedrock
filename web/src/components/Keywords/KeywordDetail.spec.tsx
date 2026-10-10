import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { KeywordDetail } from './KeywordDetail';
import { mockAuthenticatedFetch } from '../../test/infrastructureMock';
import { createMockJsonResponse } from '../../test/fetchResponses';
import {
  NEWEST, UNSORTED_RUNS
} from '../../formatting/searchSummary-fixtures';

vi.mock('../../infrastructure', () => import('../../test/infrastructureMock'));
vi.mock('react-chartjs-2', () => ({
  Line: vi.fn(() => null),
  Bar: vi.fn(() => null),
}));

/** Mounts the detail once the API has answered with the three runs, newest one in the middle. */
async function renderLoadedDetail(): Promise<void> {
  mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({ searches: UNSORTED_RUNS }));
  render(<KeywordDetail keyword="altiplano air flights to cusco" onClose={vi.fn()} />);
  await screen.findByText('Run History');
}

/** The value shown next to the `label` stat in the header. */
function getStatValueElement(label: string): Element | null {
  return screen.getByText(`${label}:`).nextElementSibling;
}

describe('KeywordDetail', () => {
  it('shows the newest run as the last run even when it is not first in the response', async () => {
    await renderLoadedDetail();

    expect(getStatValueElement('Last Run')?.textContent).toBe(new Date(NEWEST.timestamp).toLocaleDateString());
  });

  it('summarises the runs, their citations and the average per run', async () => {
    await renderLoadedDetail();

    expect(['Total Runs', 'Citations', 'Avg/Run'].map((label) => getStatValueElement(label)?.textContent))
      .toStrictEqual(['3', '3', '1.0']);
  });

  it('lists the runs newest-first', async () => {
    await renderLoadedDetail();

    expect(screen.getAllByText(/^(openai|perplexity|gemini)$/).map((badge) => badge.textContent))
      .toStrictEqual(['openai', 'perplexity', 'gemini']);
  });
});
