import { useMemo } from 'react';
import type { BrandLeaderboardRow } from '../../../types/domain/visibility';
import { useThemedChart } from '../../Dashboard/useThemedChart';
import { ChartFigure } from './ChartFigure';
import {
  buildShareOfVoiceChartConfiguration, DEFAULT_SHARE_OF_VOICE_LIMIT, describeShareOfVoice, shareOfVoiceSlices
} from './shareOfVoiceChartConfiguration';

interface Props {readonly brands: readonly BrandLeaderboardRow[];}

/** Each brand's share of all brand mentions: your brand emerald, competitors amber, others gray. */
export function ShareOfVoiceChart({ brands }: Props) {
  const slices = useMemo(() => shareOfVoiceSlices(brands, DEFAULT_SHARE_OF_VOICE_LIMIT), [brands]);
  const {
    canvasRef, hasData
  } = useThemedChart(slices, buildShareOfVoiceChartConfiguration);

  return (
    <ChartFigure
      canvasRef={canvasRef}
      hasData={hasData}
      caption={describeShareOfVoice(slices)}
      emptyText="No brand has a share of voice yet."
      heightClassName="h-64"
    />
  );
}
