import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** The retry `ResearchRunStatus` offers on a partial or failed provider run. */
const retryButtonQuery = ['button', { name: 'Retry failed providers' }] as const;

export const getRetryButtonElement = () => screen.getByRole(...retryButtonQuery);

export const queryRetryButtonElement = () => screen.queryByRole(...retryButtonQuery);

export async function clickRetryButton(): Promise<void> {
  await userEvent.setup().click(getRetryButtonElement());
}
