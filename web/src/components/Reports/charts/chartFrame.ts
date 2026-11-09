import { createContext } from 'react';

/**
 * Where a chart is drawn: `panel` inside a ChartPanel card (which frames it),
 * `section` straight inside a report section (the chart frames itself as a
 * card, so every report chart sits in one), `bare` anywhere else.
 */
export type ChartFrame = 'bare' | 'section' | 'panel';

export const CHART_FRAME_CONTEXT = createContext<ChartFrame>('bare');
