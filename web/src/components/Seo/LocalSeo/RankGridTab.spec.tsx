import {
  screen, within
} from '@testing-library/react';
import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  buildGridJob, buildStartJobResponse
} from '../../../api/seoLocal-fixtures';
import { startLocalJob } from './localSeoApi-fixtures';
import {
  GRID_CONFIRM, askForGrid, runGrid, setupLocalSeoPage
} from './LocalSeoView-fixtures';

vi.mock('../../../api/seo', () => import('./localSeoApi-fixtures'));
vi.mock('../../../api/seoLocal', () => import('./localSeoApi-fixtures'));
vi.mock('../../../hooks/useSeoSettings');

beforeEach(setupLocalSeoPage);

describe('RankGridTab confirmation', () => {
  it('asks to confirm the paid call count, without a price, before running the grid', async () => {
    await askForGrid();

    expect(screen.getByRole('dialog')).toHaveTextContent(
      'This starts 9 paid DataForSEO calls, one Google Maps search per point. Running the same grid again within an hour reuses them. Continue?',
    );
  });

  it('buys nothing until the grid is confirmed', async () => {
    await askForGrid('tea');

    expect(startLocalJob).not.toHaveBeenCalledWith(expect.anything());
  });

  it('starts the grid job around the market city once confirmed', async () => {
    await runGrid();

    expect(startLocalJob).toHaveBeenCalledWith({
      kind: 'grid',
      keyword: 'coffee',
      grid_size: 3,
      spacing_km: 2,
      market_id: 'cl-es' 
    });
  });

  it('buys nothing when the confirmation is cancelled', async () => {
    const user = await askForGrid('juice');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('button', { name: GRID_CONFIRM })).toBeNull();
    expect(startLocalJob).not.toHaveBeenCalledWith(expect.anything());
  });
});

describe('RankGridTab results', () => {
  it('draws the grid ranks north row first', async () => {
    await runGrid();

    const grid = await screen.findByRole('table', { name: 'Rank grid, north at the top' });
    expect(within(grid).getAllByRole('cell').map((cell) => cell.textContent)).toStrictEqual(['1', '4', '15', '–', '2', '3', '8', '–', '11']);
  });

  it('colours a top-three rank green', async () => {
    await runGrid();

    expect(await screen.findByLabelText('Row 1, column 1: rank 1')).toHaveClass('bg-emerald-700');
  });

  it('summarises how often the business was found', async () => {
    await runGrid();

    expect(await screen.findByText(/Found at 7 of 9 points · average rank 6\.29/)).toBeInTheDocument();
  });

  it('shows progress while the grid searches are still running', async () => {
    startLocalJob.mockResolvedValue(buildStartJobResponse(buildGridJob('collecting', null)));

    await runGrid();

    expect(await screen.findByText(/Waiting for DataForSEO… 0 of 9 ready/)).toBeInTheDocument();
  });
});
