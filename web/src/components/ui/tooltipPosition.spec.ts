import {
  describe, expect, it
} from 'vitest';
import {
  TOOLTIP_MARGIN, tooltipPosition
} from './tooltipPosition';

const VIEWPORT = {
  width: 1000,
  height: 800,
};
const TOOLTIP = {
  width: 288,
  height: 120,
};

describe('tooltipPosition', () => {
  it('centres the tooltip under a button in the middle of the page', () => {
    const anchor = {
      top: 300,
      bottom: 316,
      left: 492,
      width: 16,
    };

    expect(tooltipPosition(anchor, TOOLTIP, VIEWPORT)).toStrictEqual({
      top: 316 + TOOLTIP_MARGIN,
      left: 500 - 144,
    });
  });

  it('keeps the tooltip inside the left edge for a button near it', () => {
    const anchor = {
      top: 300,
      bottom: 316,
      left: 20,
      width: 16,
    };

    expect(tooltipPosition(anchor, TOOLTIP, VIEWPORT).left).toBe(TOOLTIP_MARGIN);
  });

  it('keeps the tooltip inside the right edge for a button near it', () => {
    const anchor = {
      top: 300,
      bottom: 316,
      left: 980,
      width: 16,
    };

    expect(tooltipPosition(anchor, TOOLTIP, VIEWPORT).left).toBe(1000 - TOOLTIP_MARGIN - 288);
  });

  it('opens above a button near the bottom when there is room above', () => {
    const anchor = {
      top: 740,
      bottom: 756,
      left: 492,
      width: 16,
    };

    expect(tooltipPosition(anchor, TOOLTIP, VIEWPORT).top).toBe(740 - TOOLTIP_MARGIN - 120);
  });

  it('stays below when the tooltip fits exactly above the bottom margin', () => {
    const anchor = {
      top: 648,
      bottom: 664,
      left: 492,
      width: 16,
    };

    expect(tooltipPosition(anchor, TOOLTIP, VIEWPORT).top).toBe(664 + TOOLTIP_MARGIN);
  });

  it('opens above when the tooltip would reach into the bottom margin', () => {
    const anchor = {
      top: 652,
      bottom: 668,
      left: 492,
      width: 16,
    };

    expect(tooltipPosition(anchor, TOOLTIP, VIEWPORT).top).toBe(652 - TOOLTIP_MARGIN - 120);
  });

  it('stays below when there is no room above either', () => {
    const anchor = {
      top: 100,
      bottom: 116,
      left: 492,
      width: 16,
    };
    const tall = {
      width: 288,
      height: 780,
    };

    expect(tooltipPosition(anchor, tall, VIEWPORT).top).toBe(116 + TOOLTIP_MARGIN);
  });

  it('opens above when the tooltip fits exactly under the top margin', () => {
    const anchor = {
      top: 136,
      bottom: 152,
      left: 492,
      width: 16,
    };
    const tall = {
      width: 288,
      height: 120,
    };
    const short = {
      width: 1000,
      height: 200,
    };

    expect(tooltipPosition(anchor, tall, short).top).toBe(TOOLTIP_MARGIN);
  });
});
