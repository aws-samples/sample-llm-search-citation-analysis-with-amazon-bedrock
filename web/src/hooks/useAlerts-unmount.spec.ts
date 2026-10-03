import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { prepareAlertHookTest } from './alertsApiMock-fixtures';
import { UNMOUNT_SETTLEMENT_CASES } from './useAlerts-unmount-fixtures';

vi.mock('../api/alerts', () => import('./alertsApiMock-fixtures'));

beforeEach(prepareAlertHookTest);

describe('alert actions settling after unmount', () => {
  it.each(UNMOUNT_SETTLEMENT_CASES)(
    'returns $action cancellation when $condition arrives after unmount',
    async ({
      start, settle, cancellation
    }) => {
      const started = await start();

      started.unmount();
      settle(started);

      await expect(started.pending).resolves.toStrictEqual(cancellation);
    }
  );
});
