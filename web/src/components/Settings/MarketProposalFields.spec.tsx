import userEvent from '@testing-library/user-event';
import {
  render, screen
} from '@testing-library/react';
import {
  describe, expect, it, vi
} from 'vitest';
import { SANTIAGO_REQUEST } from '../Markets/markets-fixtures';
import {
  EMPTY_CHOICE, MarketProposalFields, proposalRequest, sameRequest, type MarketChoice
} from './MarketProposalFields';

const CHILEAN_CHOICE: MarketChoice = {
  country: 'CL',
  language: 'es',
  city: '',
};

/** The fields over `choice`; returns the callback they report changes to. */
function renderProposalFields(choice: MarketChoice, disabled = false) {
  const onChange = vi.fn();
  render(<MarketProposalFields choice={choice} disabled={disabled} onChange={onChange} />);
  return onChange;
}

describe('proposalRequest', () => {
  it.each([
    ['the country', {
      ...CHILEAN_CHOICE,
      country: '',
    }],
    ['the language', {
      ...CHILEAN_CHOICE,
      language: '',
    }],
  ])('is nothing while %s is missing', (_description, choice) => {
    expect(proposalRequest(choice)).toBeNull();
  });

  it('leaves the city out when it is blank', () => {
    expect(proposalRequest({
      ...CHILEAN_CHOICE,
      city: '   ',
    })).toStrictEqual({
      country: 'CL',
      language: 'es',
    });
  });

  it('sends the city trimmed', () => {
    expect(proposalRequest({
      ...CHILEAN_CHOICE,
      city: ' Santiago ',
    })).toStrictEqual({
      country: 'CL',
      language: 'es',
      city: 'Santiago',
    });
  });
});

describe('sameRequest', () => {
  it('treats a request without a city and one with a blank city as the same', () => {
    expect(sameRequest({
      country: 'CL',
      language: 'es',
    }, {
      country: 'CL',
      language: 'es',
      city: '',
    })).toBe(true);
  });

  it.each([
    ['country', {
      ...SANTIAGO_REQUEST,
      country: 'AR',
    }],
    ['language', {
      ...SANTIAGO_REQUEST,
      language: 'en',
    }],
    ['city', {
      ...SANTIAGO_REQUEST,
      city: 'Valparaíso',
    }],
  ])('tells requests apart by %s', (_description, other) => {
    expect(sameRequest(SANTIAGO_REQUEST, other)).toBe(false);
  });
});

describe('MarketProposalFields', () => {
  it('offers the countries and languages by English name', () => {
    renderProposalFields(EMPTY_CHOICE);

    expect(screen.getByRole('option', { name: 'Chile' })).toHaveValue('CL');
    expect(screen.getByRole('option', { name: 'Portuguese' })).toHaveValue('pt');
  });

  it('reports the chosen country with the rest of the choice', async () => {
    const onChange = renderProposalFields({
      ...EMPTY_CHOICE,
      city: 'Santiago',
    });

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^Country/u }), 'CL');

    expect(onChange).toHaveBeenCalledWith({
      country: 'CL',
      language: '',
      city: 'Santiago',
    });
  });

  it('reports the chosen language', async () => {
    const onChange = renderProposalFields(EMPTY_CHOICE);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^Language/u }), 'es');

    expect(onChange).toHaveBeenCalledWith({
      ...EMPTY_CHOICE,
      language: 'es',
    });
  });

  it('reports the typed city', async () => {
    const onChange = renderProposalFields(CHILEAN_CHOICE);

    await userEvent.type(screen.getByLabelText('City'), 'S');

    expect(onChange).toHaveBeenCalledWith({
      ...CHILEAN_CHOICE,
      city: 'S',
    });
  });

  it('takes no changes while disabled', () => {
    renderProposalFields(CHILEAN_CHOICE, true);

    expect(screen.getByRole('combobox', { name: /^Language/u })).toBeDisabled();
    expect(screen.getByLabelText('City')).toBeDisabled();
  });
});
