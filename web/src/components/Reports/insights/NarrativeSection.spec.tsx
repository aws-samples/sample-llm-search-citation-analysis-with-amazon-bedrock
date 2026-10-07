import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  fireEvent, render, screen, within
} from '@testing-library/react';
import { formatDate } from '../../../formatting/dateFormatter';
import { useIsAdmin } from '../../../hooks/useIsAdmin';
import {
  buildRegeneratedNarrative, mockApiPost, stubRegenerateAndPoll
} from '../../../hooks/useNarrativeRegeneration-fixtures';
import {
  NARRATIVE_POLL_ATTEMPTS, NARRATIVE_POLL_INTERVAL_MS, REGENERATE_TIMEOUT_MESSAGE
} from '../../../hooks/useNarrativeRegeneration';
import { buildInsights } from '../../../types/domain/insights-fixtures';
import {
  buildNarrative, buildNarrativeInsight
} from '../../../types/domain/insightsNarrative-fixtures';
import {
  advanceFakeTime, runEachTestWithFakeTimers
} from '../../../test/fakeTime';
import { expectRendersNothing } from '../../../test/renderNothing';
import { settledSlice } from '../layout/reportSlice-fixtures';
import { sectionTitled } from '../layout/reportQueries-fixtures';
import { insightSentence } from './insightWording';
import {
  NARRATIVE_EMPTY, NARRATIVE_TITLE, NarrativeSection, REGENERATING_MESSAGE
} from './NarrativeSection';
import {
  citedInsightLines, confirmRegenerate, GROUP_SCOPE, narrativeItems, openRegenerateDialog, queryRegenerateButton, renderNarrative
} from './NarrativeSection-fixtures';

vi.mock('../../../hooks/useIsAdmin', () => ({ useIsAdmin: vi.fn() }));
vi.mock('../../../api/client', () => import('../../../hooks/useNarrativeRegeneration-fixtures'));

const mockUseIsAdmin = vi.mocked(useIsAdmin);

function mockAdmin(isAdmin: boolean) {
  mockUseIsAdmin.mockReturnValue({
    isAdmin,
    loading: false,
  });
}

describe('NarrativeSection', () => {
  beforeEach(() => {
    mockAdmin(false);
  });

  describe('placeholder states', () => {
    it('renders nothing before the insights are requested', () => {
      expectRendersNothing(<NarrativeSection {...settledSlice(null)} scope={GROUP_SCOPE} days={90} />);
    });

    it('shows the loading message under its title while the insights load', () => {
      render(<NarrativeSection data={null} loading error={null} scope={GROUP_SCOPE} days={90} />);

      expect(within(sectionTitled(NARRATIVE_TITLE)).getByText('Loading insights…')).toBeInTheDocument();
    });

    it('says no narrative was written yet when the run has none', () => {
      renderNarrative(null);

      expect(within(sectionTitled(NARRATIVE_TITLE)).getByText(NARRATIVE_EMPTY)).toBeInTheDocument();
    });
  });

  describe('the stored narrative', () => {
    it('lists each written insight', () => {
      renderNarrative();

      expect(narrativeItems('Insights')[0]).toContain(buildNarrativeInsight().text);
    });

    it('lists each recommendation with its title and text', () => {
      renderNarrative();

      expect(narrativeItems('Recommendations')[0]).toContain('Ganar el primer puesto en OpenAI');
      expect(narrativeItems('Recommendations')[0]).toContain('Publicar comparativas de tarifas que OpenAI pueda citar.');
    });

    it('reads out every computed insight an item cites, with its numbers', () => {
      renderNarrative();

      expect(citedInsightLines('Recommendations', 0)).toStrictEqual(
        buildInsights().slice(0, 2).map((insight) => `Based on: ${insightSentence(insight)}`)
      );
    });

    it('names a cited insight that is no longer computed by its id', () => {
      renderNarrative(buildNarrative({ insights: [buildNarrativeInsight({ insight_ids: ['engine_play:claude'] })] }));

      expect(citedInsightLines('Insights', 0)).toStrictEqual(['Based on: engine_play:claude']);
    });

    it('marks the narrative with the keyword language it is written in', () => {
      renderNarrative();

      expect(screen.getByRole('list', { name: 'Insights' }).closest('[lang]')).toHaveAttribute('lang', 'es');
    });

    it('says which model wrote the narrative for which run, and when', () => {
      const narrative = buildNarrative();
      renderNarrative(narrative);

      expect(screen.getByText(/^Written by/)).toHaveTextContent(
        `Written by global.anthropic.claude-sonnet-4-6 on ${formatDate(narrative.generated_at)} for the run of ${formatDate(narrative.run_timestamp)}.`
      );
    });

    it('says how many items the validator left out', () => {
      renderNarrative(buildNarrative({ dropped: 2 }));

      expect(screen.getByText(/^Written by/)).toHaveTextContent('2 items were left out for citing a number or an insight the facts do not hold.');
    });

    it('mentions no left-out item when the validator kept every one', () => {
      renderNarrative(buildNarrative({ dropped: 0 }));

      expect(screen.getByText(/^Written by/)).not.toHaveTextContent('left out');
    });

    it('omits the recommendations heading when there is none', () => {
      renderNarrative(buildNarrative({ recommendations: [] }));

      expect(screen.queryByRole('list', { name: 'Recommendations' })).not.toBeInTheDocument();
    });
  });

  describe('regenerate for a user who is not an admin', () => {
    it('offers no Regenerate button', () => {
      renderNarrative();

      expect(queryRegenerateButton()).not.toBeInTheDocument();
    });
  });

  describe('regenerate', () => {
    beforeEach(() => {
      mockAdmin(true);
    });

    it('offers no Regenerate button outside a keyword group', () => {
      renderNarrative(buildNarrative(), { kind: 'all' });

      expect(queryRegenerateButton()).not.toBeInTheDocument();
    });

    it('asks an admin to confirm before regenerating', () => {
      renderNarrative();

      openRegenerateDialog();

      expect(screen.getByText('Regenerate the narrative?')).toBeInTheDocument();
      expect(mockApiPost).not.toHaveBeenCalled();
    });

    it('requests nothing when the admin cancels', () => {
      renderNarrative();

      openRegenerateDialog();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(mockApiPost).not.toHaveBeenCalled();
    });

    it('shows Regenerating… once confirmed', async () => {
      stubRegenerateAndPoll(buildNarrative());
      renderNarrative();

      await confirmRegenerate();

      expect(screen.getByRole('status')).toHaveTextContent(REGENERATING_MESSAGE);
      expect(mockApiPost).toHaveBeenCalledWith('/reports/insights/regenerate', { group_id: 'group-coruna' }, expect.anything());
    });
  });

  describe('regenerate polling', () => {
    runEachTestWithFakeTimers();

    beforeEach(() => {
      mockAdmin(true);
    });

    it('shows the new narrative once it is stored', async () => {
      stubRegenerateAndPoll(buildRegeneratedNarrative());
      renderNarrative();

      await confirmRegenerate();
      await advanceFakeTime(NARRATIVE_POLL_INTERVAL_MS);

      expect(narrativeItems('Insights')[0]).toContain('Gemini cita a Aurora Airways en solo el 20% de las respuestas.');
    });

    it('says the narrative is late when no new one arrives in time', async () => {
      stubRegenerateAndPoll(buildNarrative());
      renderNarrative();

      await confirmRegenerate();
      await advanceFakeTime(NARRATIVE_POLL_INTERVAL_MS * NARRATIVE_POLL_ATTEMPTS);

      expect(screen.getByRole('status')).toHaveTextContent(REGENERATE_TIMEOUT_MESSAGE);
    });
  });
});
