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

/** A 16px info button whose top edge is at `top`, horizontally centred on the page unless `left` is given. */
function fakeAnchor(top: number, left = 492) {
  return {
    top,
    bottom: top + 16,
    left,
    width: 16,
  };
}

describe('tooltipPosition', () => {
  it('centres the tooltip under a button in the middle of the page', () => {
    expect(tooltipPosition(fakeAnchor(300), TOOLTIP, VIEWPORT)).toStrictEqual({
      top: 316 + TOOLTIP_MARGIN,
      left: 500 - 144,
    });
  });

  it('keeps the tooltip inside the left edge for a button near it', () => {
    expect(tooltipPosition(fakeAnchor(300, 20), TOOLTIP, VIEWPORT).left).toBe(TOOLTIP_MARGIN);
  });

  it('keeps the tooltip inside the right edge for a button near it', () => {
    expect(tooltipPosition(fakeAnchor(300, 980), TOOLTIP, VIEWPORT).left).toBe(1000 - TOOLTIP_MARGIN - 288);
  });

  it('opens above a button near the bottom when there is room above', () => {
    expect(tooltipPosition(fakeAnchor(740), TOOLTIP, VIEWPORT).top).toBe(740 - TOOLTIP_MARGIN - 120);
  });

  it('stays below when the tooltip fits exactly above the bottom margin', () => {
    expect(tooltipPosition(fakeAnchor(648), TOOLTIP, VIEWPORT).top).toBe(664 + TOOLTIP_MARGIN);
  });

  it('opens above when the tooltip would reach into the bottom margin', () => {
    expect(tooltipPosition(fakeAnchor(652), TOOLTIP, VIEWPORT).top).toBe(652 - TOOLTIP_MARGIN - 120);
  });

  it('stays below when there is no room above either', () => {
    const tall = {
      width: 288,
      height: 780,
    };

    expect(tooltipPosition(fakeAnchor(100), tall, VIEWPORT).top).toBe(116 + TOOLTIP_MARGIN);
  });

  it('opens above when the tooltip fits exactly under the top margin', () => {
    const short = {
      width: 1000,
      height: 200,
    };

    expect(tooltipPosition(fakeAnchor(136), TOOLTIP, short).top).toBe(TOOLTIP_MARGIN);
  });
});
