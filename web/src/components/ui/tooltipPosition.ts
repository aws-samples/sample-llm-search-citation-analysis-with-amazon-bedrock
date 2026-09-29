/** The gap between the viewport edge, or the "i" button, and the tooltip, in pixels. */
export const TOOLTIP_MARGIN = 8;

interface Box {
  readonly width: number;
  readonly height: number;
}

interface Anchor {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly width: number;
}

/** Viewport coordinates of the tooltip's top-left corner. */
export interface TooltipPosition {
  readonly top: number;
  readonly left: number;
}

/**
 * Where a tooltip of `tooltip` size goes for a button at `anchor`: centred
 * under the button, moved sideways to stay inside the viewport, and above the
 * button when there is no room below but there is above.
 */
export function tooltipPosition(anchor: Anchor, tooltip: Box, viewport: Box): TooltipPosition {
  const centred = anchor.left + (anchor.width - tooltip.width) / 2;
  const rightmost = viewport.width - TOOLTIP_MARGIN - tooltip.width;
  const left = Math.max(TOOLTIP_MARGIN, Math.min(centred, rightmost));

  const below = anchor.bottom + TOOLTIP_MARGIN;
  const above = anchor.top - TOOLTIP_MARGIN - tooltip.height;
  const fitsBelow = below + tooltip.height <= viewport.height - TOOLTIP_MARGIN;
  const fitsAbove = above >= TOOLTIP_MARGIN;
  const top = !fitsBelow && fitsAbove ? above : below;

  return {
    top,
    left,
  };
}
