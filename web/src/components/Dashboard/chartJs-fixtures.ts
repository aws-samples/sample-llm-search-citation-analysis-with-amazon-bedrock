import { vi } from 'vitest';

/**
 * Stand-in for the `chart.js` module in dashboard chart specs:
 * `vi.mock('chart.js', () => import('./chartJs-fixtures'));`
 * The constructor mock yields a chart that can be destroyed but never draws.
 * It is a function expression, so `new Chart(...)` works under Vitest 4.
 */
const chartConstructorMock = Object.assign(
  vi.fn(function constructChart() {
    return { destroy: vi.fn() };
  }),
  { register: vi.fn() },
);

const registerables: never[] = [];

export {
  chartConstructorMock as Chart, registerables 
};
