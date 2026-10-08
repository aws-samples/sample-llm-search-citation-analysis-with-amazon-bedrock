import {
  buildMarketSelectionMock, marketSelectionWrapper
} from '../components/Markets/markets-fixtures';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';

/** A `renderHook` wrapper with Chile picked in the header. */
export const CHILE_PICKED = marketSelectionWrapper(buildMarketSelectionMock({ selectedMarketId: 'cl-es' }));

/** The query of the first request made through `authenticatedFetch`. */
export function firstRequestQuery(): URLSearchParams {
  const url = mockAuthenticatedFetch.mock.calls[0]?.[0];
  return new URL(typeof url === 'string' ? url : 'https://invalid.test').searchParams;
}
