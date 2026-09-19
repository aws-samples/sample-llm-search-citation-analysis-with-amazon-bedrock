import {
  describe, expect, it, vi
} from 'vitest';
import {
  screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DISCLOSURE,
  fillSeedAndStart,
  getPromptTextarea,
  getTemplateSelect,
  renderBriefForm,
  SAVED_COPY,
  TEMPLATES,
} from './AgentBriefForm-fixtures';

describe('AgentBriefForm', () => {
  it('groups the templates into industry and saved ones with the hotels built-in selected', () => {
    renderBriefForm();

    const select = getTemplateSelect();
    expect(select).toHaveValue('builtin-default');
    expect(within(within(select).getByRole('group', { name: 'Industry templates' })).getAllByRole('option').map((option) => option.textContent)).toStrictEqual(['Hotels', 'Cafés']);
    expect(within(within(select).getByRole('group', { name: 'Your templates' })).getAllByRole('option').map((option) => option.textContent)).toStrictEqual(['Urban hotels']);
  });

  it('words the brief for the selected template subject', () => {
    renderBriefForm();

    expect(screen.getByRole('heading', { name: 'Research a hotel' })).toBeInTheDocument();
    expect(screen.getByLabelText('Hotel (or seed)')).toHaveAttribute('placeholder', 'e.g. Hotel Gran Marino');
  });

  it('checks every dimension of the template by default', () => {
    renderBriefForm();

    const boxes = screen.getAllByRole<HTMLInputElement>('checkbox');
    expect(boxes).toHaveLength(6);
    expect(boxes.every((box) => box.checked)).toBe(true);
  });

  it('switches label, placeholder and dimensions when another template is chosen', async () => {
    renderBriefForm();

    await userEvent.selectOptions(getTemplateSelect(), 'builtin-cafes');

    expect(screen.getByRole('heading', { name: 'Research a café' })).toBeInTheDocument();
    expect(screen.getByLabelText('Café (or seed)')).toHaveAttribute('placeholder', 'e.g. Café Central');
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByRole('checkbox', { name: /^Menu & drinks/ })).toBeChecked();
  });

  it('starts the run with the template, all its dimensions and no prompt override when nothing was edited', async () => {
    const handlers = renderBriefForm();

    await userEvent.selectOptions(getTemplateSelect(), 'builtin-cafes');
    await fillSeedAndStart('Café Central');

    expect(handlers.onStart).toHaveBeenCalledWith({
      seed: 'Café Central',
      country: 'es',
      language: 'es',
      dimensions: ['menu', 'location', 'occasion'],
      instruction: '',
      targetCount: 60,
      trackingCount: 15,
      maxRounds: 2,
      templateId: 'builtin-cafes',
      systemPrompt: null,
      groupId: null,
    });
  });

  it('sends the checked dimensions in template order when some are unticked and re-ticked', async () => {
    const handlers = renderBriefForm();

    await userEvent.click(screen.getByRole('checkbox', { name: /^Destination/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /^Audience/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /^Destination/ }));
    await fillSeedAndStart('Hotel Gran Marino');

    expect(handlers.onStart).toHaveBeenCalledWith(expect.objectContaining({ dimensions: ['destination', 'location', 'points_of_interest', 'hotel_attributes', 'trip_type'] }));
  });

  it('sends the edited prompt when the instructions were changed', async () => {
    const handlers = renderBriefForm();

    await userEvent.click(screen.getByText(DISCLOSURE));
    await userEvent.type(getPromptTextarea(), ' Prefer Galician cities.');
    await fillSeedAndStart('Hotel Gran Marino');

    expect(handlers.onStart).toHaveBeenCalledWith(expect.objectContaining({
      templateId: 'builtin-default',
      systemPrompt: 'You are a hotel SEO researcher for a hotel group. Prefer Galician cities.',
    }));
  });

  it('keeps an edited prompt across a template switch and offers to reset it', async () => {
    renderBriefForm();
    await userEvent.click(screen.getByText(DISCLOSURE));
    await userEvent.type(getPromptTextarea(), '!');

    await userEvent.selectOptions(getTemplateSelect(), 'builtin-cafes');
    expect(getPromptTextarea()).toHaveValue('You are a hotel SEO researcher for a hotel group.!');

    await userEvent.click(screen.getByRole('button', { name: 'Reset to template' }));
    expect(getPromptTextarea()).toHaveValue('You are an SEO researcher for independent cafés.');
    expect(screen.queryByRole('button', { name: 'Reset to template' })).toBeNull();
  });

  it('adopts the new template prompt on a switch when the instructions were not edited', async () => {
    renderBriefForm();

    await userEvent.selectOptions(getTemplateSelect(), 't1');

    expect(getPromptTextarea()).toHaveValue('You research urban hotels for business travellers.');
    expect(screen.queryByRole('button', { name: 'Reset to template' })).toBeNull();
  });

  it('lists the problems instead of starting when the brief is incomplete', async () => {
    const handlers = renderBriefForm();

    await userEvent.selectOptions(getTemplateSelect(), 'builtin-cafes');
    await userEvent.click(screen.getByRole('checkbox', { name: /^Menu & drinks/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /^Location/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /^Occasion/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Start research' }));

    expect(handlers.onStart).not.toHaveBeenCalled();
    expect(within(screen.getByRole('alert')).getAllByRole('listitem').map((item) => item.textContent)).toStrictEqual([
      'Enter the café name (or a seed keyword).',
      'Pick at least one expansion dimension.',
    ]);
  });

  it('selects the saved copy after saving the template as new', async () => {
    const handlers = renderBriefForm();
    await userEvent.selectOptions(getTemplateSelect(), 'builtin-cafes');
    await userEvent.click(screen.getByText(DISCLOSURE));

    await userEvent.click(screen.getByRole('button', { name: 'Save as new template' }));
    handlers.rerenderWith([...TEMPLATES, SAVED_COPY]);

    expect(handlers.onSaveTemplate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Cafés (copy)',
      baseTemplateId: 'builtin-cafes',
    }));
    expect(getTemplateSelect()).toHaveValue('t9');
    expect(screen.getByText('Template "Cafés (copy)" saved')).toBeInTheDocument();
  });

  it('falls back to the hotels built-in after deleting the selected template', async () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    const handlers = renderBriefForm();
    await userEvent.selectOptions(getTemplateSelect(), 't1');
    await userEvent.click(screen.getByText(DISCLOSURE));

    await userEvent.click(screen.getByRole('button', { name: 'Delete template' }));

    expect(handlers.onDeleteTemplate).toHaveBeenCalledWith('t1');
    expect(getTemplateSelect()).toHaveValue('builtin-default');
    expect(screen.getByText('Template deleted')).toBeInTheDocument();
  });

  it('shows the default tracking recommendation as a demand proxy', () => {
    renderBriefForm();

    expect(screen.getByLabelText('Tracking keywords')).toHaveValue(15);
    expect(screen.getByText('Recommended active shortlist. This is a demand proxy, not measured search volume.')).toBeInTheDocument();
  });

  it('caps tracking keywords when the proposal target is reduced', async () => {
    renderBriefForm();

    await userEvent.clear(screen.getByLabelText('Target keywords'));

    expect(screen.getByLabelText('Target keywords')).toHaveValue(10);
    expect(screen.getByLabelText('Tracking keywords')).toHaveValue(10);
  });

  it('starts the run with an adjusted tracking count', async () => {
    const handlers = renderBriefForm();
    await userEvent.clear(screen.getByLabelText('Tracking keywords'));
    await userEvent.type(screen.getByLabelText('Tracking keywords'), '2');

    await fillSeedAndStart('Hotel Gran Marino');

    expect(handlers.onStart).toHaveBeenCalledWith(expect.objectContaining({ trackingCount: 2 }));
  });

  it('offers the groups sorted by name with the choose-later default', () => {
    renderBriefForm();

    const options = within(screen.getByLabelText('Add results to group')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toStrictEqual(['Choose later', 'A Coruña (12)', 'Zaragoza (4)']);
  });

  it('shows the cost ceiling for the chosen number of rounds', async () => {
    renderBriefForm();

    await userEvent.selectOptions(screen.getByLabelText('Research rounds'), '3');

    expect(screen.getByText(/Up to 24 web searches, 5 model calls/)).toBeInTheDocument();
  });
});
