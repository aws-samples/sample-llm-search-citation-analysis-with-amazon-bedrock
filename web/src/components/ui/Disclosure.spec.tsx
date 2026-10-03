import {
  describe, expect, it
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Disclosure } from './Disclosure';

const TITLE = 'How these KPIs are measured';
const CONTENT = 'Mention rate: answers naming the brand.';

function renderDisclosure(headingLevel: 2 | 3 = 2) {
  return render(
    <Disclosure title={TITLE} headingLevel={headingLevel} headingClassName="text-base" headingId="definitions-heading">
      <p>{CONTENT}</p>
    </Disclosure>,
  );
}

function getToggleElement() {
  return screen.getByRole('button', { name: TITLE });
}

function getControlledElement() {
  return document.getElementById(getToggleElement().getAttribute('aria-controls') ?? '');
}

describe('Disclosure', () => {
  it('starts collapsed, with its content hidden', () => {
    renderDisclosure();

    expect(getToggleElement().getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText(CONTENT)).not.toBeVisible();
  });

  it('shows its content when the heading is clicked', async () => {
    renderDisclosure();

    await userEvent.click(getToggleElement());

    expect(screen.getByText(CONTENT)).toBeVisible();
  });

  it('marks itself expanded when open', async () => {
    renderDisclosure();

    await userEvent.click(getToggleElement());

    expect(getToggleElement().getAttribute('aria-expanded')).toBe('true');
  });

  it('collapses again on a second click', async () => {
    renderDisclosure();

    await userEvent.click(getToggleElement());
    await userEvent.click(getToggleElement());

    expect(screen.getByText(CONTENT)).not.toBeVisible();
  });

  it('opens from the keyboard', async () => {
    renderDisclosure();

    await userEvent.tab();
    await userEvent.keyboard('{Enter}');

    expect(screen.getByText(CONTENT)).toBeVisible();
  });

  it('points the toggle at the content it controls', () => {
    renderDisclosure();

    expect(getControlledElement()?.textContent).toBe(CONTENT);
  });

  it('keeps the collapsed content in the page for print', () => {
    renderDisclosure();

    expect(getControlledElement()?.classList.contains('print-reveal')).toBe(true);
  });

  it('leaves the chevron off paper, so a printout shows a plain heading', () => {
    renderDisclosure();

    expect(getToggleElement().querySelector('svg')?.classList.contains('print-hidden')).toBe(true);
  });

  it.each([[2, 'H2'], [3, 'H3']] as const)('renders an h%s heading named by its title', (level, tag) => {
    renderDisclosure(level);

    expect([screen.getByRole('heading', { name: TITLE }).tagName, screen.getByRole('heading', { name: TITLE }).id]).toStrictEqual([
      tag, 'definitions-heading',
    ]);
  });
});
