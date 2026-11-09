import { vi } from 'vitest';
import {
  fireEvent, render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { TagInput } from './TagInput';

type TagInputProps = ComponentProps<typeof TagInput>;

/** The brand-name field holding Altiplano Air and Condor Sur, with a fresh spy per callback. */
function buildProps(overrides: Partial<TagInputProps> = {}): TagInputProps {
  return {
    items: ['Altiplano Air', 'Condor Sur'],
    draft: '',
    onDraftChange: vi.fn(),
    onCommit: vi.fn(),
    onRemove: vi.fn(),
    removeLabel: (item) => `Remove ${item}`,
    inputId: 'new-first-party-brand',
    inputLabel: 'Add brand name',
    placeholder: 'Add brand name',
    ...overrides,
  };
}

/** Mounts the field over `buildProps(overrides)` and returns the props, for asserting on the spies. */
export function renderTagInput(overrides: Partial<TagInputProps> = {}): TagInputProps {
  const props = buildProps(overrides);
  render(<TagInput {...props} />);
  return props;
}

/** The text box, found by its accessible name. */
export function getDraftInput(): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>('Add brand name');
}

/** Clicks the "×" of a chip. */
export function removeTagWithClick(item: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: `Remove ${item}` }));
  return Promise.resolve();
}

/** Tabs into a field holding only `item` (its "×" is the first stop), checks the focus, and presses Space. */
export async function removeTagWithKeyboard(item: string): Promise<void> {
  await userEvent.tab();
  if (document.activeElement !== screen.getByRole('button', { name: `Remove ${item}` })) return;
  await userEvent.keyboard(' ');
}
