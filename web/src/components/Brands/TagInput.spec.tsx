import {
  describe, expect, it
} from 'vitest';
import {
  fireEvent, screen
} from '@testing-library/react';
import {
  getDraftInput, removeTagWithClick, removeTagWithKeyboard, renderTagInput
} from './TagInput-fixtures';

describe('TagInput', () => {
  it('gives the text box its configured id, label and placeholder', () => {
    renderTagInput();

    const input = getDraftInput();

    expect([input.id, input.getAttribute('aria-label'), input.placeholder]).toStrictEqual([
      'new-first-party-brand', 'Add brand name', 'Add brand name',
    ]);
  });

  it('reports the typed text through onDraftChange', () => {
    const props = renderTagInput();

    fireEvent.change(getDraftInput(), { target: { value: 'JetPuma' } });

    expect(props.onDraftChange).toHaveBeenCalledWith('JetPuma');
  });

  it.each([
    ['Add is clicked', (): void => { fireEvent.click(screen.getByRole('button', { name: 'Add' })); }],
    ['Enter is pressed in the box', (): void => { fireEvent.keyDown(getDraftInput(), { key: 'Enter' }); }],
    ['a comma is typed in the box', (): void => { fireEvent.keyDown(getDraftInput(), { key: ',' }); }],
  ])('adds the draft when %s', (_trigger, addValue) => {
    const props = renderTagInput({ draft: 'JetPuma' });

    addValue();

    expect(props.onCommit).toHaveBeenCalledWith();
  });

  it('does not add the draft on other keys', () => {
    const props = renderTagInput({ draft: 'JetPuma' });

    fireEvent.keyDown(getDraftInput(), { key: 'a' });

    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it('shows the Add button only once something is typed', () => {
    renderTagInput({ draft: '  ' });

    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
  });

  it('lists every value as a chip with its own remove button', () => {
    renderTagInput();

    expect(screen.getByText('Altiplano Air')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Altiplano Air' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Condor Sur' })).toBeInTheDocument();
  });

  it('shows no chips when there are no values', () => {
    renderTagInput({ items: [] });

    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
  });

  it.each([
    ['clicking its cross', removeTagWithClick],
    ['tabbing to its cross and pressing Space', removeTagWithKeyboard],
  ])('removes a value by %s', async (_how, removeTag) => {
    const props = renderTagInput({ items: ['Aurora Airways'] });

    await removeTag('Aurora Airways');

    expect(props.onRemove).toHaveBeenCalledWith('Aurora Airways');
  });

  it('renders the chips passed as children', () => {
    renderTagInput({ children: <button type="button">+ suggested.example</button> });

    expect(screen.getByRole('button', { name: '+ suggested.example' })).toBeInTheDocument();
  });

  it('tints the chips violet for the tracked brand', () => {
    renderTagInput({ tone: 'brand' });

    expect(screen.getByText('Altiplano Air').parentElement).toHaveClass('bg-violet-50');
  });

  it('disables the text box when asked', () => {
    renderTagInput({ disabled: true });

    expect(getDraftInput()).toBeDisabled();
  });
});
