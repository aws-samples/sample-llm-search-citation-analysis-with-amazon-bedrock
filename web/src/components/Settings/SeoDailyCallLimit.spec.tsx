import {
  describe, it, expect, vi
} from 'vitest';
import {
  fireEvent, screen, waitFor
} from '@testing-library/react';
import type { ProvidersConfigProps } from './ProvidersConfig';
import {
  buildDataForSeoProvider, renderProvidersConfig 
} from './ProvidersConfig-fixtures';

vi.mock('../../api/seo', () => import('../../hooks/useSeoAccount-fixtures'));

const LIMIT_FIELD = 'Calls per user per day (0 turns paid lookups off)';

/** The DataForSEO card with `limit` set (or the server's default), as an Admin or a member. */
function renderLimit(limit: number | undefined, isAdmin = true) {
  const onUpdate = vi.fn<ProvidersConfigProps['onUpdate']>().mockResolvedValue(true);
  renderProvidersConfig([buildDataForSeoProvider(limit === undefined ? {} : { daily_call_limit: limit })], {
    onUpdate,
    isAdmin,
  });
  return onUpdate;
}

describe('SEO data daily call limit', () => {
  it('shows the default of 100 calls per user per day', () => {
    renderLimit(undefined);

    expect(screen.getByText(/Each user may make up to 100 paid DataForSEO calls per day \(UTC\)\./)).toBeInTheDocument();
    expect(screen.getByLabelText(LIMIT_FIELD)).toHaveValue(100);
  });

  it('says paid lookups are off when the limit is 0', () => {
    renderLimit(0);

    expect(screen.getByText(/Paid DataForSEO lookups are off\./)).toBeInTheDocument();
  });

  it('saves the limit an Admin enters on the DataForSEO provider', async () => {
    const onUpdate = renderLimit(100);

    fireEvent.change(screen.getByLabelText(LIMIT_FIELD), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save limit' }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('dataforseo', { daily_call_limit: 250 }));
  });

  it('offers no save until the limit changes', () => {
    renderLimit(100);

    expect(screen.getByRole('button', { name: 'Save limit' })).toBeDisabled();
  });

  it.each(['-1', '2.5', '100001', ''])('refuses %j and says what is allowed', (value) => {
    renderLimit(100);

    fireEvent.change(screen.getByLabelText(LIMIT_FIELD), { target: { value } });

    expect(screen.getByRole('button', { name: 'Save limit' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('A whole number from 0 to 100,000');
  });

  it('shows a member the limit without a field to change it', () => {
    renderLimit(40, false);

    expect(screen.getByText(/up to 40 paid DataForSEO calls/)).toBeInTheDocument();
    expect(screen.queryByLabelText(LIMIT_FIELD)).not.toBeInTheDocument();
  });
});
