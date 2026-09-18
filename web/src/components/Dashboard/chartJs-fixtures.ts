import { vi } from 'vitest';

/**
 * Stand-in for the `chart.js` module in dashboard chart specs:
 * `vi.mock('chart.js', () => import('./chartJs-fixtures'));`
 * The constructor mock yields a chart that can be destroyed but never draws.
 */
const chartConstructorMock = Object.assign(
  vi.fn(() => ({ destroy: vi.fn() })),
  { register: vi.fn() },
);

const registerables: never[] = [];

export {
  chartConstructorMock as Chart, registerables 
};
