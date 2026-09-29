import {
  describe, it, expect, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { EngineSentimentSection } from './EngineSentimentSection';
import { reportWithVisibility } from './scopeReport-fixtures';
import { buildEngineKpis } from '../layout/reportPayload-fixtures';

vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));

describe('EngineSentimentSection', () => {
  it('redraws the split for the engines of newly loaded runs', () => {
    const { rerender } = render(<EngineSentimentSection report={reportWithVisibility({})} />);

    rerender(<EngineSentimentSection report={reportWithVisibility({ engines: [buildEngineKpis('perplexity')] })} />);

    expect(screen.getByText(/^Sentiment of the labelled mentions per row/).textContent).toMatch(/^Sentiment of the labelled mentions per row, stacked to 100%\. Perplexity: /);
  });
});
