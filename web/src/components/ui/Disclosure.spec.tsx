import {
  describe, expect, it
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Disclosure } from './Disclosure';

const TITLE = 'How these KPIs are measured';

function renderDisclosure(headingLevel: 2 | 3 = 2) {
  return render(
    <Disclosure title={TITLE} headingLevel={headingLevel} headingClassName="text-base" headingId="definitions-heading">
      <p>Mention rate: answers naming the brand.</p>
    </Disclosure>,
  );
}

describe('Disclosure', () => {
  it('starts collapsed, with its content hidden', () => {
    renderDisclosure();

    expect(screen.getByRole('button', { name: TITLE }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('Mention rate: answers naming the brand.')).not.toBeVisible();
  });

  it('shows its content when the heading is clicked', async () => {
    renderDisclosure();

    await userEvent.click(screen.getByRole('button', { name: TITLE }));

    expect(screen.getByText('Mention rate: answers naming the brand.')).toBeVisible();
  });

  it('marks itself expanded when open', async () => {
    renderDisclosure();

    await userEvent.click(screen.getByRole('button', { name: TITLE }));

    expect(screen.getByRole('button', { name: TITLE }).getAttribute('aria-expanded')).toBe('true');
  });

  it('collapses again on a second click', async () => {
    renderDisclosure();

    await userEvent.click(screen.getByRole('button', { name: TITLE }));
    await userEvent.click(screen.getByRole('button', { name: TITLE }));

    expect(screen.getByText('Mention rate: answers naming the brand.')).not.toBeVisible();
  });

  it('opens from the keyboard', async () => {
    renderDisclosure();

    await userEvent.tab();
    await userEvent.keyboard('{Enter}');

    expect(screen.getByText('Mention rate: answers naming the brand.')).toBeVisible();
  });

  it('points the toggle at the content it controls', () => {
    renderDisclosure();
    const controlled = screen.getByRole('button', { name: TITLE }).getAttribute('aria-controls') ?? '';

    expect(document.getElementById(controlled)?.textContent).toBe('Mention rate: answers naming the brand.');
  });

  it('keeps the collapsed content in the page for print', () => {
    renderDisclosure();
    const controlled = screen.getByRole('button', { name: TITLE }).getAttribute('aria-controls') ?? '';

    expect(document.getElementById(controlled)?.classList.contains('print-reveal')).toBe(true);
  });

  it('leaves the chevron off paper, so a printout shows a plain heading', () => {
    renderDisclosure();

    expect(screen.getByRole('button', { name: TITLE }).querySelector('svg')?.classList.contains('print-hidden')).toBe(true);
  });

  it.each([[2, 'H2'], [3, 'H3']] as const)('renders an h%s heading named by its title', (level, tag) => {
    renderDisclosure(level);

    expect([screen.getByRole('heading', { name: TITLE }).tagName, screen.getByRole('heading', { name: TITLE }).id]).toStrictEqual([
      tag, 'definitions-heading',
    ]);
  });
});
