import {
  describe, expect, it
} from 'vitest';
import userEvent from '@testing-library/user-event';
import {
  getRefreshButtonElement, renderRefreshButton
} from './RefreshTextButton-fixtures';

describe('RefreshTextButton', () => {
  it('refreshes when clicked', async () => {
    const onRefresh = renderRefreshButton();

    await userEvent.click(getRefreshButtonElement());

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('is enabled and idle by default', () => {
    renderRefreshButton();

    expect(getRefreshButtonElement()).toBeEnabled();
    expect(getRefreshButtonElement()).toHaveAttribute('aria-busy', 'false');
  });

  it('is disabled when the caller disables it', () => {
    renderRefreshButton({ disabled: true });

    expect(getRefreshButtonElement()).toBeDisabled();
  });

  it('is disabled and busy while a refresh is in flight', () => {
    renderRefreshButton({ loading: true });

    expect(getRefreshButtonElement()).toBeDisabled();
    expect(getRefreshButtonElement()).toHaveAttribute('aria-busy', 'true');
  });

  it('shows no icon unless asked', () => {
    renderRefreshButton();

    expect(getRefreshButtonElement().querySelector('svg')).toBeNull();
  });

  it('draws a still refresh icon when asked while idle', () => {
    renderRefreshButton({ showIcon: true });

    expect(getRefreshButtonElement().querySelector('svg')).not.toHaveClass('animate-spin');
  });

  it('spins the refresh icon while a refresh is in flight', () => {
    renderRefreshButton({
      showIcon: true,
      loading: true,
    });

    expect(getRefreshButtonElement().querySelector('svg')).toHaveClass('animate-spin');
  });

  it('keeps the layout classes the caller adds', () => {
    renderRefreshButton({ layoutClassName: 'self-start ' });

    expect(getRefreshButtonElement()).toHaveClass('self-start', 'bg-gray-100');
  });
});
