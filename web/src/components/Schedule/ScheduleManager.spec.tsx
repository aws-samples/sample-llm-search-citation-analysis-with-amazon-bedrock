import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen, waitFor, within 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ScheduleManager } from './ScheduleManager';
import { trackerLink } from './RankTrackerScheduleList';
import {
  GROUP_CORUNA,
  GROUP_MARINO,
  buildProps,
  buildSchedule,
  chooseScheduleAction,
  chooseWeeklyOnFriday,
  legacyKeywordSchedule,
  openCreateForm,
  openEditForm,
} from './ScheduleManager-fixtures';

vi.mock('../../infrastructure', async () => {
  const actual: Record<string, unknown> = await vi.importActual('../../infrastructure');
  return {
    ...actual,
    isAbortError: vi.fn(() => false),
  };
});

vi.mock('../../api/executions', () => import('../../api/executionsMock-fixtures'));
vi.mock('../../api/seo', () => ({ isSeoApiConfigured: vi.fn(() => true) }));

vi.mock('../../hooks/useIsAdmin', () => ({ useIsAdmin: vi.fn() }));
vi.mock('../../hooks/useKeywordGroups', () => ({ useKeywordGroups: vi.fn() }));

import {
  createSchedule, deleteSchedule, fetchRankTrackerSchedules, fetchSchedules, runSchedule, updateSchedule 
} from '../../api/executions';
import type { Schedule } from '../../types';
import { useIsAdmin } from '../../hooks/useIsAdmin';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';
import { buildKeywordGroupsHookResult } from '../../hooks/useKeywordGroups-fixtures';
import { ApiRequestError } from '../../infrastructure';
import { isSeoApiConfigured } from '../../api/seo';
import {
  browserTimezone, formDataFromSchedule, toSchedulePayload
} from './scheduleFormModel';

const mockFetchSchedules = vi.mocked(fetchSchedules);
const mockCreateSchedule = vi.mocked(createSchedule);
const mockUpdateSchedule = vi.mocked(updateSchedule);
const mockDeleteSchedule = vi.mocked(deleteSchedule);
const mockRunSchedule = vi.mocked(runSchedule);
const mockUseIsAdmin = vi.mocked(useIsAdmin);
const mockUseKeywordGroups = vi.mocked(useKeywordGroups);
const mockFetchRankTrackerSchedules = vi.mocked(fetchRankTrackerSchedules);

const weeklySchedule = buildSchedule();

function mockGroups(groups = [GROUP_CORUNA, GROUP_MARINO]) {
  mockUseKeywordGroups.mockReturnValue(buildKeywordGroupsHookResult(groups));
}

function mockAdmin(isAdmin: boolean) {
  mockUseIsAdmin.mockReturnValue({
    isAdmin,
    loading: false,
  });
}

function renderManager(schedules: Schedule[] = []) {
  const props = buildProps({ schedules });
  render(<MemoryRouter><ScheduleManager {...props} /></MemoryRouter>);
  return props;
}

async function renderCreateForm() {
  const props = renderManager();
  await openCreateForm();
  return props;
}

async function renderNamedCreateForm(name: string) {
  const props = await renderCreateForm();
  await userEvent.type(screen.getByLabelText('Schedule name'), name);
  return props;
}

async function renderEditForm(schedule: Schedule = weeklySchedule) {
  renderManager([schedule]);
  await openEditForm(schedule.display_name);
}

describe('ScheduleManager', () => {
  beforeEach(() => {
    mockAdmin(true);
    mockGroups();
    mockFetchSchedules.mockResolvedValue([]);
    mockCreateSchedule.mockResolvedValue(weeklySchedule);
    mockUpdateSchedule.mockResolvedValue(weeklySchedule);
    mockDeleteSchedule.mockResolvedValue();
    mockRunSchedule.mockResolvedValue({message: 'Analysis started for Hotel Coruña — weekly (1 group(s))',});
  });

  describe('schedule list', () => {
    it('renders the display name, not the generated id', () => {
      renderManager([weeklySchedule]);

      expect(screen.getByText('Hotel Coruña — weekly')).toBeInTheDocument();
      expect(screen.queryByText('sch-1a2b3c4d')).not.toBeInTheDocument();
    });

    it('describes the timing in words instead of the raw cron', () => {
      renderManager([weeklySchedule]);

      expect(screen.getByText('Every Monday at 09:00 (Europe/Madrid)')).toBeInTheDocument();
    });

    it('names the groups a group-scoped schedule runs', () => {
      renderManager([weeklySchedule]);

      expect(screen.getByText('Groups: Hotel Coruña')).toBeInTheDocument();
    });

    it('says all active keywords for an all-scope schedule', () => {
      renderManager([buildSchedule({ scope: { mode: 'all' } })]);

      expect(screen.getByText('All active keywords')).toBeInTheDocument();
    });

    it('marks legacy schedules and lists their keyword texts', () => {
      renderManager([legacyKeywordSchedule]);

      expect(screen.getByText('Legacy')).toBeInTheDocument();
      expect(screen.getByText(/2 keyword\(s\) from the previous version: best hotels malaga, boutique hotels madrid/)).toBeInTheDocument();
    });

    it('shows a disabled schedule with its switch off', () => {
      renderManager([buildSchedule({ enabled: false })]);

      expect(screen.getByRole('switch', { name: 'Hotel Coruña — weekly enabled' })).not.toBeChecked();
    });

    it('shows empty state when no schedules', async () => {
      renderManager();

      expect(await screen.findByText(/No schedules/i)).toBeInTheDocument();
    });

    it('holds placeholder schedule rows instead of the empty state until the first list arrives', () => {
      mockFetchSchedules.mockImplementation(() => new Promise(vi.fn()));
      renderManager();

      expect(screen.getByText('Loading schedules')).toBeInTheDocument();
      expect(screen.queryByText(/No schedules/i)).not.toBeInTheDocument();
    });
  });

  describe('initial load', () => {
    it('loads schedules from the API on mount', async () => {
      mockFetchSchedules.mockResolvedValue([weeklySchedule]);

      const props = renderManager();

      await waitFor(() => expect(props.setSchedules).toHaveBeenCalledWith([weeklySchedule]));
    });
  });

  describe('creating a schedule', () => {
    async function submitCreateForm() {
      await userEvent.click(screen.getByRole('button', { name: 'Create schedule' }));
    }

    it('opens the form in a dialog named by its title', async () => {
      await renderCreateForm();

      expect(screen.getByRole('dialog', { name: 'New schedule' })).toBeInTheDocument();
    });

    it('suggests a generated name as the placeholder', async () => {
      await renderCreateForm();

      expect(screen.getByLabelText('Schedule name')).toHaveAttribute('placeholder', 'Daily analysis · all keywords');
    });

    it('defaults to running all keywords daily at 09:00 in the browser timezone, enabled', async () => {
      await renderCreateForm();

      expect(screen.getByRole('radio', { name: /All active keywords/i })).toBeChecked();
      expect(['Repeat', 'Time', 'Timezone'].map((label) => (screen.getByLabelText(label) as HTMLInputElement).value))
        .toStrictEqual(['daily', '09:00', browserTimezone()]);
      expect(screen.getByRole('switch', { name: 'Enabled' })).toBeChecked();
    });

    it('saves a blank name as the generated one', async () => {
      await renderCreateForm();

      await submitCreateForm();

      expect(mockCreateSchedule).toHaveBeenCalledWith(expect.objectContaining({ display_name: 'Daily analysis · all keywords' }));
    });

    it('says the timing in words with the next run while the form is filled in', async () => {
      await renderCreateForm();
      await chooseWeeklyOnFriday();

      expect(screen.getByText(new RegExp(`^Every Friday at 09:00 \\(${browserTimezone()}\\)\\.`))).toHaveTextContent(/Next run: /);
    });

    it('posts the display name, timing and scope', async () => {
      await renderNamedCreateForm('Hotel Coruña — weekly');
      await chooseWeeklyOnFriday();
      await userEvent.clear(screen.getByLabelText('Timezone'));
      await userEvent.type(screen.getByLabelText('Timezone'), 'Europe/Madrid');
      await userEvent.click(screen.getByRole('radio', { name: /Keyword groups/i }));
      await userEvent.click(screen.getByRole('checkbox', { name: 'Include group Hotel Coruña' }));

      await submitCreateForm();

      expect(mockCreateSchedule).toHaveBeenCalledWith({
        kind: 'analysis',
        display_name: 'Hotel Coruña — weekly',
        frequency: 'weekly',
        time: '09:00',
        timezone: 'Europe/Madrid',
        day_of_week: 'FRI',
        day_of_month: 1,
        enabled: true,
        scope: {
          mode: 'groups',
          group_ids: ['group-coruna'] 
        },
      });
    });

    it('sends the picked keyword ids for a specific-keywords scope', async () => {
      await renderNamedCreateForm('Priority');
      await userEvent.click(screen.getByRole('radio', { name: /Specific keywords/i }));
      await userEvent.click(screen.getByRole('checkbox', { name: 'best hotels malaga' }));

      await submitCreateForm();

      expect(mockCreateSchedule).toHaveBeenCalledWith(expect.objectContaining({
        scope: {
          mode: 'keywords',
          keyword_ids: ['kw-1'] 
        },
      }));
    });

    it('blocks saving a group scope with no group selected', async () => {
      await renderNamedCreateForm('Empty');
      await userEvent.click(screen.getByRole('radio', { name: /Keyword groups/i }));

      await submitCreateForm();

      expect(screen.getByRole('alert')).toHaveTextContent('Select at least one keyword group');
      expect(mockCreateSchedule).not.toHaveBeenCalled();
    });

    it('points at Settings when there are no groups to pick', async () => {
      mockGroups([]);
      await renderCreateForm();

      await userEvent.click(screen.getByRole('radio', { name: /Keyword groups/i }));

      expect(screen.getByText(/No keyword groups yet/i)).toBeInTheDocument();
    });

    it('offers only days 1 to 28 for monthly schedules, so every month has the day', async () => {
      await renderNamedCreateForm('Monthly');
      await userEvent.selectOptions(screen.getByLabelText('Repeat'), 'monthly');

      const days = within(screen.getByLabelText('Day of month')).getAllByRole('option').map((option) => option.textContent);
      expect([days.length, days[0], days[days.length - 1]]).toStrictEqual([28, '1', '28']);
    });

    it('refreshes the list and closes the form after a successful creation', async () => {
      mockFetchSchedules.mockResolvedValue([weeklySchedule]);
      const props = await renderNamedCreateForm('Hotel Coruña — weekly');

      await submitCreateForm();

      await waitFor(() => expect(props.setSchedules).toHaveBeenCalledWith([weeklySchedule]));
      expect(mockFetchSchedules).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('form', { name: 'Create schedule' })).not.toBeInTheDocument();
    });

    it('shows the server rejection when the API refuses the schedule', async () => {
      mockCreateSchedule.mockRejectedValue(new ApiRequestError('Unknown timezone', {
        statusCode: 400,
        responseMessage: "Unknown timezone 'Mars/Base'. Use an IANA name such as Europe/Madrid",
      }));
      await renderNamedCreateForm('Bad zone');

      await submitCreateForm();

      expect(screen.getByText(/Unknown timezone 'Mars\/Base'/)).toBeInTheDocument();
    });
  });

  describe('editing a schedule', () => {
    it('opens the form pre-filled from the schedule when its card is clicked', async () => {
      await renderEditForm();

      expect(screen.getByRole('form', { name: 'Edit schedule' })).toBeInTheDocument();
      expect(screen.getByLabelText('Schedule name')).toHaveValue('Hotel Coruña — weekly');
      expect(screen.getByLabelText('Repeat')).toHaveValue('weekly');
      expect(screen.getByLabelText('Timezone')).toHaveValue('Europe/Madrid');
    });

    it('pre-selects the schedule scope', async () => {
      await renderEditForm();

      expect(screen.getByRole('radio', { name: /Keyword groups/i })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Include group Hotel Coruña' })).toBeChecked();
    });

    it('saves through PUT with the changed fields and the untouched ones', async () => {
      await renderEditForm();
      await userEvent.clear(screen.getByLabelText('Time'));
      await userEvent.type(screen.getByLabelText('Time'), '18:30');
      await userEvent.click(screen.getByRole('switch', { name: 'Enabled' }));

      await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      expect(mockUpdateSchedule).toHaveBeenCalledWith('sch-1a2b3c4d', {
        kind: 'analysis',
        display_name: 'Hotel Coruña — weekly',
        frequency: 'weekly',
        time: '18:30',
        timezone: 'Europe/Madrid',
        day_of_week: 'MON',
        day_of_month: 1,
        enabled: false,
        scope: {
          mode: 'groups',
          group_ids: ['group-coruna'] 
        },
      });
      expect(mockCreateSchedule).not.toHaveBeenCalled();
    });

    it('explains that a legacy keyword-text schedule must be re-scoped', async () => {
      await renderEditForm(legacyKeywordSchedule);

      expect(screen.getByText(/Choose its keywords again below/)).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /All active keywords/i })).toBeChecked();
    });

    it('cancel closes the editor without saving', async () => {
      await renderEditForm();

      await userEvent.click(within(screen.getByRole('form', { name: 'Edit schedule' })).getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByRole('form', { name: 'Edit schedule' })).not.toBeInTheDocument();
      expect(mockUpdateSchedule).not.toHaveBeenCalled();
    });
  });

  describe('run now', () => {
    async function runScheduleNow(displayName: string) {
      await chooseScheduleAction(displayName, 'Run now');
    }

    it('starts an execution for the schedule and reports it', async () => {
      renderManager([weeklySchedule]);

      await runScheduleNow('Hotel Coruña — weekly');

      expect(mockRunSchedule).toHaveBeenCalledWith('sch-1a2b3c4d', false);
      expect(screen.getByText('Analysis started for Hotel Coruña — weekly (1 group(s))')).toBeInTheDocument();
    });

    it('does not open the editor when run now is clicked', async () => {
      renderManager([weeklySchedule]);

      await runScheduleNow('Hotel Coruña — weekly');

      expect(screen.queryByRole('form', { name: 'Edit schedule' })).not.toBeInTheDocument();
    });
  });

  describe('deleting a schedule', () => {
    async function confirmDeleteOfWeeklySchedule() {
      await chooseScheduleAction('Hotel Coruña — weekly', 'Delete');
      await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    }

    it('deletes by id after confirmation and drops the row', async () => {
      const props = renderManager([weeklySchedule]);

      await confirmDeleteOfWeeklySchedule();

      expect(mockDeleteSchedule).toHaveBeenCalledWith('sch-1a2b3c4d');
      expect(props.setSchedules).toHaveBeenCalledWith([]);
    });

    it('keeps the row and reports the error when the API refuses', async () => {
      mockDeleteSchedule.mockRejectedValue(new ApiRequestError('Forbidden', { statusCode: 403 }));
      const props = renderManager([weeklySchedule]);

      await confirmDeleteOfWeeklySchedule();

      expect(screen.getByText('Managing schedules requires an administrator')).toBeInTheDocument();
      // Only the mount-time load touched the list; the failed delete did not.
      expect(props.setSchedules).toHaveBeenCalledTimes(1);
    });
  });
});

describe('ScheduleManager admin-only controls', () => {
  /**
   * Mutations are Admin-only server-side. Reads stay open, so a non-admin
   * keeps visibility of what is scheduled without any control that would
   * return 403.
   */

  beforeEach(() => {
    mockAdmin(false);
    mockGroups();
    mockFetchSchedules.mockResolvedValue([]);
  });

  it('hides the new schedule button from non-admin users', () => {
    renderManager();

    expect(screen.queryByRole('button', { name: /New Schedule/i })).not.toBeInTheDocument();
  });

  it('hides edit, run and delete from non-admin users', () => {
    renderManager([weeklySchedule]);

    expect(screen.queryByRole('button', { name: /Edit schedule/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
  });

  it('still lists existing schedules for non-admin users', () => {
    renderManager([weeklySchedule]);

    expect(screen.getByText('Hotel Coruña — weekly')).toBeInTheDocument();
  });

  it('tells non-admin users an administrator adds schedules', async () => {
    /** The admin copy says "Create a schedule", which they cannot do. */
    renderManager();

    expect(await screen.findByText(/An administrator can add a schedule/i)).toBeInTheDocument();
  });

  it('shows the actions menu and the switch to admin users', () => {
    /** Guards the assertions above from passing because of a renamed label. */
    mockAdmin(true);

    renderManager([weeklySchedule]);

    expect(screen.getByRole('button', { name: 'Actions for Hotel Coruña — weekly' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Hotel Coruña — weekly enabled' })).toBeChecked();
  });
});

// Schedule kinds (2.43.0): paid snapshot schedules next to analysis runs, and
// the rank trackers' own schedules listed read-only.
const backlinkSchedule: Schedule = buildSchedule({
  id: 'sch-b1',
  display_name: 'Weekly backlink snapshots',
  kind: 'backlink_snapshots',
  scope: null,
  scope_summary: 'every owned and competitor domain',
});

/** Opens the create form, picks backlink snapshots and saves (disabled first when `enabled` is false). */
async function renderBacklinkCreate({ enabled = true } = {}) {
  renderManager();
  await openCreateForm();
  await userEvent.click(screen.getByRole('radio', { name: /^Backlink snapshots/ }));
  if (!enabled) await userEvent.click(screen.getByRole('switch', { name: 'Enabled' }));
  await userEvent.click(screen.getByRole('button', { name: 'Create schedule' }));
}

/** Renders the backlink snapshot schedule and picks `action` from its ⋯ menu. */
async function renderBacklinkCardAction(action: 'Run now' | 'Edit') {
  renderManager([backlinkSchedule]);
  await chooseScheduleAction('Weekly backlink snapshots', action);
}

/** The paid confirmation, which opens on top of the schedule dialog (or alone, from a row). */
async function findPaidConfirmationElement(): Promise<HTMLElement> {
  return (await screen.findByText(/Continue\?$/)).closest('dialog') as HTMLElement;
}

/** Answers the paid confirmation with the button named `name`. */
async function renderAnswerToDialog(name: string) {
  await userEvent.click(within(await findPaidConfirmationElement()).getByRole('button', { name }));
}

describe('ScheduleManager kinds', () => {
  beforeEach(() => {
    mockAdmin(true);
    mockGroups([]);
    mockFetchSchedules.mockResolvedValue([]);
    mockCreateSchedule.mockResolvedValue(backlinkSchedule);
    mockRunSchedule.mockResolvedValue({ message: 'Weekly backlink snapshots started' });
    mockFetchRankTrackerSchedules.mockResolvedValue({
      schedules: [],
      truncated: false,
    });
    vi.mocked(isSeoApiConfigured).mockReturnValue(true);
  });

  describe('snapshot schedules', () => {
    it('offers only analysis runs where the SEO stack is not deployed', async () => {
      vi.mocked(isSeoApiConfigured).mockReturnValue(false);
      renderManager();
      await openCreateForm();

      expect(screen.queryByRole('radio', { name: /^Analysis run/ })).not.toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /All active keywords/ })).toBeChecked();
    });

    it('names the paid calls and hides the keyword scope once a snapshot kind is picked', async () => {
      renderManager();
      await openCreateForm();

      await userEvent.click(screen.getByRole('radio', { name: /^Domain traffic snapshots/ }));

      expect(screen.getByLabelText('Schedule name')).toHaveAttribute('placeholder', 'Weekly domain snapshots');
      expect(screen.getByLabelText('Repeat')).toHaveValue('weekly');
      expect(screen.getByText(/two paid DataForSEO calls per owned and competitor domain and market/)).toBeInTheDocument();
      expect(screen.queryByText('Which keywords')).not.toBeInTheDocument();
    });

    it('asks before saving an enabled paid schedule, naming its paid calls', async () => {
      await renderBacklinkCreate();

      const dialog = await findPaidConfirmationElement();
      expect(within(dialog).getByText(/one paid DataForSEO call per owned and competitor domain/)).toBeInTheDocument();
      expect(mockCreateSchedule).not.toHaveBeenCalled();
    });

    it('posts the snapshot kind and its default name without a scope once confirmed', async () => {
      await renderBacklinkCreate();
      await renderAnswerToDialog('Save');

      await waitFor(() => expect(mockCreateSchedule).toHaveBeenCalledTimes(1));
      const payload = mockCreateSchedule.mock.calls[0][0];
      expect([payload.kind, payload.display_name, 'scope' in payload, payload.confirm_paid]).toStrictEqual([
        'backlink_snapshots', 'Weekly backlink snapshots', false, true,
      ]);
    });

    it('saves nothing when the paid confirmation is cancelled', async () => {
      await renderBacklinkCreate();
      await renderAnswerToDialog('Cancel');

      expect(mockCreateSchedule).not.toHaveBeenCalled();
    });

    it('saves a disabled snapshot schedule without asking: it never runs', async () => {
      await renderBacklinkCreate({ enabled: false });

      await waitFor(() => expect(mockCreateSchedule.mock.calls[0]?.[0].enabled).toBe(false));
    });

    it('marks a snapshot schedule as paid and shows what it covers', () => {
      renderManager([backlinkSchedule]);

      expect(screen.getByText('Paid')).toBeInTheDocument();
      expect(screen.getByText('Backlink snapshots: every owned and competitor domain')).toBeInTheDocument();
    });

    it('asks before running a snapshot schedule now', async () => {
      await renderBacklinkCardAction('Run now');

      expect(mockRunSchedule).not.toHaveBeenCalled();
      await renderAnswerToDialog('Run');

      await waitFor(() => expect(mockRunSchedule).toHaveBeenCalledWith('sch-b1', true));
    });

    it('shows the kind without a picker when editing: a schedule keeps its kind', async () => {
      await renderBacklinkCardAction('Edit');

      expect(screen.queryByRole('combobox', { name: 'Runs' })).not.toBeInTheDocument();
      expect(within(screen.getByRole('form', { name: 'Edit schedule' })).getByText('Backlink snapshots')).toBeInTheDocument();
    });
  });

  describe('row switch', () => {
    it('switches a schedule off by saving it with only enabled changed, without a success dialog', async () => {
      renderManager([weeklySchedule]);

      await userEvent.click(screen.getByRole('switch', { name: 'Hotel Coruña — weekly enabled' }));

      await waitFor(() => expect(mockUpdateSchedule).toHaveBeenCalledWith('sch-1a2b3c4d', {
        ...toSchedulePayload(formDataFromSchedule(weeklySchedule)),
        enabled: false,
      }));
      expect(screen.queryByText('Schedule updated successfully')).not.toBeInTheDocument();
    });

    it('asks before switching a paid schedule on, then confirms the spend', async () => {
      renderManager([{
        ...backlinkSchedule,
        enabled: false,
      }]);

      await userEvent.click(screen.getByRole('switch', { name: 'Weekly backlink snapshots enabled' }));
      expect(mockUpdateSchedule).not.toHaveBeenCalled();
      await renderAnswerToDialog('Save');

      await waitFor(() => expect(mockUpdateSchedule.mock.calls[0]?.[1]).toMatchObject({
        enabled: true,
        confirm_paid: true,
      }));
    });

    it('offers no switch for a legacy keyword-text schedule, which must be re-scoped first', () => {
      renderManager([legacyKeywordSchedule]);

      const row = screen.getByRole('listitem');
      expect([within(row).queryByRole('switch'), within(row).getByText('Enabled').tagName]).toStrictEqual([null, 'SPAN']);
    });

    it('shows when an enabled schedule runs next', () => {
      renderManager([weeklySchedule]);

      expect(screen.getByText(/^Next run: /)).toBeInTheDocument();
    });
  });

  describe('rank tracker checks', () => {
    it('lists each tracker\'s next check with a link to edit it on the tracker', async () => {
      mockFetchRankTrackerSchedules.mockResolvedValue({
        schedules: [{
          id: 'rank-a',
          tracker_id: 'a',
          display_name: 'Hotels',
          next_run_at: '2026-11-09T04:30:00Z',
          enabled: true,
        }],
        truncated: true,
      });
      renderManager();

      const section = await screen.findByRole('region', { name: 'Rank tracker checks' });
      expect(within(section).getByText('Hotels')).toBeInTheDocument();
      expect(within(section).getByRole('link', { name: 'Edit on the tracker' })).toHaveAttribute('href', trackerLink('a'));
      expect(within(section).queryByRole('button')).not.toBeInTheDocument();
      expect(within(section).getByText(/the first 100/)).toBeInTheDocument();
    });

    it('stays hidden while no tracker is scheduled', async () => {
      renderManager();

      await waitFor(() => expect(mockFetchRankTrackerSchedules).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('region', { name: 'Rank tracker checks' })).not.toBeInTheDocument();
    });
  });
});
