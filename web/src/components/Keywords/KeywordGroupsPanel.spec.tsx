import {
  describe, expect, it, vi
} from 'vitest';
import {
  screen, waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import {
  chooseGroupAction,
  KEYWORD_GROUPS,
  openNewGroupForm,
  queryNewGroupField,
  renderKeywordGroupsPanel,
} from './KeywordGroupsPanel-fixtures';
import type { KeywordGroupsPanel } from './KeywordGroupsPanel';

/** Renders the panel, opens "New group" and types `typed` (keys such as {Enter} included). */
async function renderTypedGroupName(typed: string, overrides: Partial<ComponentProps<typeof KeywordGroupsPanel>> = {}) {
  const props = renderKeywordGroupsPanel(overrides);
  const input = await openNewGroupForm();
  const user = userEvent.setup();
  await user.type(input, typed);
  return {
    props,
    user,
    input,
  };
}

async function renderAndClick(buttonName: string) {
  const props = renderKeywordGroupsPanel();
  await userEvent.setup().click(screen.getByRole('button', { name: buttonName }));
  return props;
}

/** Renders the panel and renames Hotel Coruña to "Hotel Coruña Centro" with Enter; returns its props. */
async function renderRenamedCoruna(overrides: Partial<ComponentProps<typeof KeywordGroupsPanel>> = {}) {
  const props = renderKeywordGroupsPanel(overrides);
  await chooseGroupAction('Hotel Coruña', 'Rename');
  await userEvent.setup().type(screen.getByRole('textbox', { name: 'Rename group Hotel Coruña' }), ' Centro{Enter}');
  return props;
}

describe('KeywordGroupsPanel', () => {
  it('holds placeholder group rows while the groups load for the first time', () => {
    renderKeywordGroupsPanel({
      groups: [],
      loading: true,
    });

    expect(screen.getByRole('status')).toHaveTextContent('Loading groups');
  });

  it('keeps the group rows without a placeholder while groups reload', () => {
    renderKeywordGroupsPanel({ loading: true });

    expect(screen.queryByText('Loading groups')).not.toBeInTheDocument();
  });

  it('describes reusable groups with generic examples', () => {
    renderKeywordGroupsPanel();

    expect(screen.getByText(
      'Group keywords by brand, market, campaign or location. A keyword can belong to several groups.'
    )).toBeInTheDocument();
  });

  it('opens the new-group field only on request, with a generic campaign example', async () => {
    renderKeywordGroupsPanel();
    expect(queryNewGroupField()).not.toBeInTheDocument();

    expect(await openNewGroupForm()).toHaveAttribute('placeholder', 'e.g. Spring campaign');
  });

  it('shows every group with its keyword count', () => {
    renderKeywordGroupsPanel();

    expect(screen.getByRole('button', { name: 'Hotel Coruña, 3 keywords' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hotel Gran Marino, 0 keywords' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All, 5 keywords' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ungrouped, 2 keywords' })).toBeInTheDocument();
  });

  it('marks the selected filter as pressed', () => {
    renderKeywordGroupsPanel({ filter: { groupId: 'coruna' } });

    expect(screen.getAllByRole('button', { pressed: true }).map((button) => button.getAttribute('aria-label')))
      .toStrictEqual(['Hotel Coruña, 3 keywords']);
  });

  it('creates a group from the trimmed input and closes the field on success', async () => {
    const {
      props, user
    } = await renderTypedGroupName('  Hotel Playa  ');

    await user.click(screen.getByRole('button', { name: 'Create group' }));

    expect(props.onCreate).toHaveBeenCalledWith('Hotel Playa');
    await waitFor(() => expect(queryNewGroupField()).not.toBeInTheDocument());
  });

  it('closes the new-group field on Escape without creating', async () => {
    const { props } = await renderTypedGroupName('Hotel Playa{Escape}');

    expect(queryNewGroupField()).not.toBeInTheDocument();
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it('surfaces a failed creation through onNotify and keeps the typed name', async () => {
    const {
      props, input
    } = await renderTypedGroupName('Hotel Coruña{Enter}', {
      onCreate: vi.fn().mockResolvedValue({
        success: false,
        message: 'A keyword group with this name already exists'
      }),
    });

    await waitFor(() => expect(props.onNotify).toHaveBeenCalledWith(
      'Could not create group',
      'A keyword group with this name already exists',
      'error'
    ));
    expect(input).toHaveValue('Hotel Coruña');
  });

  it('selects a group as the active filter when it is clicked', async () => {
    const props = await renderAndClick('Hotel Coruña, 3 keywords');

    expect(props.onFilterChange).toHaveBeenCalledWith({ groupId: 'coruna' });
  });

  it('offers Rename and Delete in each group menu', async () => {
    renderKeywordGroupsPanel();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Actions for group Hotel Coruña' }));

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toStrictEqual(['Rename', 'Delete']);
  });

  it('renames a group inline', async () => {
    const props = renderKeywordGroupsPanel();
    await chooseGroupAction('Hotel Coruña', 'Rename');

    const input = screen.getByRole('textbox', { name: 'Rename group Hotel Coruña' });
    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, 'Hotel A Coruña{Enter}');

    expect(props.onRename).toHaveBeenCalledWith('coruna', 'Hotel A Coruña');
  });

  it('closes the inline rename once the rename succeeds', async () => {
    await renderRenamedCoruna();

    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Rename group Hotel Coruña' })).not.toBeInTheDocument());
  });

  it('reports a refused rename under "Could not rename group"', async () => {
    const props = await renderRenamedCoruna({
      onRename: vi.fn().mockResolvedValue({
        success: false,
        message: 'A group with that name already exists',
      }),
    });

    await waitFor(() => expect(props.onNotify).toHaveBeenCalledWith(
      'Could not rename group', 'A group with that name already exists', 'error'
    ));
  });

  it('asks the parent to delete the group with the full group record', async () => {
    const props = renderKeywordGroupsPanel();

    await chooseGroupAction('Hotel Gran Marino', 'Delete');

    expect(props.onDelete).toHaveBeenCalledWith(KEYWORD_GROUPS[1]);
  });
});
