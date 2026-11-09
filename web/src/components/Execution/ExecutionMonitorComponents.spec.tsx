import {
  render, screen
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  buildGroup, buildKeyword
} from '../../api/keywordGroups-fixtures';
import { TriggerSection } from './TriggerSection';
import { EVERY_KEYWORD_RUN } from './runSelection';
import { keywordPickerIdentity } from '../../test/fieldIdentity';
import { mockAuthenticatedFetch } from '../../test/infrastructureMock';
import {
  answerRunTargets, buildEngine
} from './runTargets-fixtures';

vi.mock('../../infrastructure', () => import('../../test/infrastructureMock'));

// The engine list stays in flight unless a test answers it, so the other tests see no late update.
beforeEach(() => {
  mockAuthenticatedFetch.mockReturnValue(new Promise(() => undefined));
});

const ST_LOUIS_GROUP = {
  id: 'group-st-louis',
  name: 'Hotel St Louis',
  keyword_count: 1,
};

describe('TriggerSection', () => {
  const renderTriggerSection = (props: Partial<Parameters<typeof TriggerSection>[0]> = {}) => render(
    <TriggerSection
      selection={EVERY_KEYWORD_RUN}
      onSelectionChange={vi.fn()}
      keywordsCount={53}
      activeKeywords={[
        buildKeyword({
          id: 'keyword-1',
          keyword: 'accessible hotels',
          group_ids: ['group-st-louis'],
        }),
      ]}
      groups={[]}
      isRunning={false}
      isStarting={false}
      onTriggerAnalysis={vi.fn()}
      isAdmin
      loading={false}
      {...props}
    />,
    { wrapper: MemoryRouter }
  );

  const getStartButtonElement = () => screen.getByRole('button', { name: /Start analysis/u });
  const queryStartButtonElement = () => screen.queryByRole('button', { name: /Start analysis/u });

  const renderGroupScope = (group: Parameters<typeof buildGroup>[0], groupIds: string[] = []) => renderTriggerSection({
    selection: {
      ...EVERY_KEYWORD_RUN,
      mode: 'groups',
      groupIds,
    },
    groups: [buildGroup(group)],
  });

  it('shows the analysis options placeholder instead of the panel while loading', () => {
    renderTriggerSection({ loading: true });

    expect(screen.getByRole('status')).toHaveTextContent('Loading analysis options');
    expect(queryStartButtonElement()).not.toBeInTheDocument();
  });

  it('does not tell an administrator that runs need an administrator while membership loads', () => {
    renderTriggerSection({
      loading: true,
      isAdmin: false,
    });

    expect(screen.queryByText(/requires an administrator/u)).not.toBeInTheDocument();
  });

  it('defaults to every active keyword, with no keyword list on screen', () => {
    renderTriggerSection();

    expect(screen.getByRole('radio', { name: /All active keywords/u })).toBeChecked();
    expect(screen.queryByLabelText('Search keywords')).not.toBeInTheDocument();
    expect(getStartButtonElement()).toBeEnabled();
  });

  it('applies execution-specific identities to the shared keyword picker', () => {
    renderTriggerSection({
      keywordsCount: 1,
      selection: {
        ...EVERY_KEYWORD_RUN,
        mode: 'keywords',
      },
    });

    expect(keywordPickerIdentity('accessible hotels')).toStrictEqual({
      search: {
        id: 'execution-keyword-scope-search',
        labelFor: 'execution-keyword-scope-search',
        name: 'execution-keyword-scope-search',
      },
      keyword: {
        id: 'execution-keyword-scope-section-__ungrouped__-keyword-keyword-1',
        labelFor: 'execution-keyword-scope-section-__ungrouped__-keyword-keyword-1',
        name: 'execution-keyword-ids',
        value: 'keyword-1',
      },
    });
  });

  /**
   * REGRESSION: the panel promised runs that the scope could not resolve.
   *
   * A no-selection run resolves to active keywords only, and so does a group
   * run, but the summary line counted the whole keyword library and the group
   * buttons counted paused members. An install with 53 keywords of which 13
   * were active read "All 53 active keywords", and a group holding only paused
   * keywords offered an enabled button that failed with "No active keywords
   * match the selected scope (1 group(s))".
   */
  it('summarizes a default run by the active keywords it will resolve, not the library size', () => {
    renderTriggerSection();

    expect(screen.getByText(/1 active keyword in every market/u)).toBeInTheDocument();
    expect(screen.queryByText(/53 active keywords/u)).not.toBeInTheDocument();
  });

  it('disables a group that has no active keywords and says why', () => {
    renderGroupScope({
      id: 'group-branson',
      name: 'Hotel Branson',
      keyword_count: 0,
    });

    const checkbox = screen.getByRole('checkbox', { name: 'Include group Hotel Branson' });

    expect(checkbox).toBeDisabled();
    expect(checkbox.closest('label')).toHaveAttribute('title', 'Hotel Branson has no active keywords to run');
  });

  it('keeps a group with active keywords pickable and counts its keywords once picked', () => {
    renderGroupScope(ST_LOUIS_GROUP, ['group-st-louis']);

    const checkbox = screen.getByRole('checkbox', { name: 'Include group Hotel St Louis' });

    expect(checkbox).toBeEnabled();
    expect(checkbox.closest('label')).not.toHaveAttribute('title');
    expect(screen.getByText(/1 active keyword in every market/u)).toBeInTheDocument();
  });

  it('disables Start and says what to do while the chosen scope resolves to no keyword', () => {
    renderGroupScope(ST_LOUIS_GROUP);

    expect(getStartButtonElement()).toBeDisabled();
    expect(screen.getByText('Pick at least one keyword or group with active keywords.')).toBeInTheDocument();
  });

  it('names the engines and personas each keyword is sent to and how many answers that makes', async () => {
    answerRunTargets();
    renderTriggerSection();

    expect(await screen.findByText('3 AI engines: OpenAI, Perplexity, Google AI Overviews')).toBeInTheDocument();
    expect(screen.getByText('2 personas: Family Traveler, Business traveler')).toBeInTheDocument();
    // 1 keyword × (2 chat engines × 2 personas + 1 AI Overview)
    expect(screen.getByText('Up to 5 answers, each a billed request to an AI engine.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Personas' })).toHaveAttribute('href', '/settings/personas');
  });

  it('warns before Start when no AI engine is ready', async () => {
    answerRunTargets([buildEngine({ enabled: false })]);
    renderTriggerSection();

    expect(await screen.findByText(/No AI engine is enabled with an API key/u)).toBeInTheDocument();
  });

  it('gives no answer count when the engine list cannot be read', async () => {
    answerRunTargets(null);
    renderTriggerSection();

    expect(await screen.findByText(/Could not read the AI engine list/u)).toBeInTheDocument();
    expect(screen.queryByText(/^Up to/u)).not.toBeInTheDocument();
  });

  it('says why Start is disabled while a run is in progress and offers no links out', () => {
    renderTriggerSection({ isRunning: true });

    expect(getStartButtonElement()).toBeDisabled();
    expect(screen.getByText('A run is in progress. Start the next one when it finishes.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'create a schedule' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'AI providers' })).not.toBeInTheDocument();
  });

  it('points to Settings › Keywords when the library is empty', () => {
    renderTriggerSection({ keywordsCount: 0 });

    expect(screen.getByRole('link', { name: 'Settings › Keywords' })).toHaveAttribute('href', '/settings/keywords');
  });

  it('tells a non-admin who can start a run, without a Start button', () => {
    renderTriggerSection({ isAdmin: false });

    expect(screen.getByText(/Starting a run needs an administrator/u)).toBeInTheDocument();
    expect(queryStartButtonElement()).not.toBeInTheDocument();
  });
});
