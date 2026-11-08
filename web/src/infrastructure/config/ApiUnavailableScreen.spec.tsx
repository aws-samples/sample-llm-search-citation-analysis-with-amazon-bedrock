import {
  describe, expect, it, vi
} from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiUnavailableScreen } from './ApiUnavailableScreen';

describe('ApiUnavailableScreen', () => {
  it('says the API is being updated', () => {
    const view = render(<ApiUnavailableScreen onRetry={vi.fn()} />);

    expect(view.getByRole('heading', { name: 'The API is being updated' })).toBeInTheDocument();
  });

  it('checks again when the user asks', async () => {
    const onRetry = vi.fn();
    const view = render(<ApiUnavailableScreen onRetry={onRetry} />);

    await userEvent.click(view.getByRole('button', { name: 'Check again' }));

    expect(onRetry).toHaveBeenCalledExactlyOnceWith();
  });
});
