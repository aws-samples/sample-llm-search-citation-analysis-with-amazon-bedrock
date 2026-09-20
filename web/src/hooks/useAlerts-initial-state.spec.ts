import {
  describe, expect, it
} from 'vitest';
import {
  renderAlertSettingsInitialState,
  renderContentChangesInitialState,
  renderOpenAlertsInitialState,
} from './useAlerts-fixtures';

describe('alert hook state before mount effects', () => {
  it('exposes alert loading with no acknowledgement before effects run', () => {
    expect(renderOpenAlertsInitialState()).toBe('loading:true;acknowledging:');
  });

  it('exposes settings loading with save and test actions idle before effects run', () => {
    expect(renderAlertSettingsInitialState()).toBe(
      'loading:true;saving:false;testing:false'
    );
  });

  it('exposes content changes idle before effects run', () => {
    expect(renderContentChangesInitialState()).toBe('loading:false;recording:false');
  });
});
