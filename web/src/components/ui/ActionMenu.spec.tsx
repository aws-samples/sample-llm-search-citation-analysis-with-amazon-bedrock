import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionMenu } from './ActionMenu';

function renderMenu() {
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  render(
    <>
      <ActionMenu label="Actions for hotels" items={[
        {
          label: 'Edit groups',
          onSelect: onEdit,
        },
        {
          label: 'Archive',
          onSelect: vi.fn(),
          disabled: true,
        },
        {
          label: 'Delete',
          onSelect: onDelete,
          tone: 'danger',
        },
      ]} />
      <p>Outside</p>
    </>
  );
  return {
    onEdit,
    onDelete,
    trigger: screen.getByRole('button', { name: 'Actions for hotels' }),
  };
}

async function renderOpenMenu() {
  const rendered = renderMenu();
  await userEvent.click(rendered.trigger);
  return rendered;
}

function queryMenuElement() {
  return screen.queryByRole('menu');
}

describe('ActionMenu', () => {
  it('adds the given classes to its trigger', () => {
    render(<ActionMenu label="Actions for group Hotels" items={[]} triggerClassName="opacity-0" />);

    expect(screen.getByRole('button', { name: 'Actions for group Hotels' })).toHaveClass('p-1.5', 'opacity-0');
  });

  it('starts closed and announces the menu it opens', () => {
    const { trigger } = renderMenu();

    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(queryMenuElement()).not.toBeInTheDocument();
  });

  it('opens on click and focuses the first item', async () => {
    const { trigger } = await renderOpenMenu();

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: 'Edit groups' })).toHaveFocus();
  });

  it('runs the picked item, closes and returns focus to the button', async () => {
    const {
      trigger, onDelete
    } = await renderOpenMenu();

    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(queryMenuElement()).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('moves with the arrow keys, skipping disabled items', async () => {
    await renderOpenMenu();

    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();

    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Edit groups' })).toHaveFocus();

    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
  });

  it('opens from the keyboard and selects with Enter', async () => {
    const {
      trigger, onEdit
    } = renderMenu();

    trigger.focus();
    await userEvent.keyboard('{Enter}{Enter}');

    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape and returns focus to the button', async () => {
    const { trigger } = await renderOpenMenu();

    await userEvent.keyboard('{Escape}');

    expect(queryMenuElement()).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it.each([
    ['a click outside', () => userEvent.click(screen.getByText('Outside'))],
    ['Tab', () => userEvent.tab()],
    ['a second press of the button', () => userEvent.click(screen.getByRole('button', { name: 'Actions for hotels' }))],
  ])('closes on %s', async (_how, act) => {
    await renderOpenMenu();

    await act();

    expect(queryMenuElement()).not.toBeInTheDocument();
  });
});
