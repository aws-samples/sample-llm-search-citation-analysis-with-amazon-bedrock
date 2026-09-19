import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentTemplateEditor } from './AgentTemplateEditor';
import {
  buildCafeTemplate, buildSavedTemplate, buildTemplate
} from './agent-fixtures';
import type { ResearchTemplate } from '../../../types';

const SAVED = buildSavedTemplate();

function renderEditor(template: ResearchTemplate, systemPrompt = template.system_prompt) {
  const handlers = {
    onPromptChange: vi.fn(),
    onSaveAsNew: vi.fn(() => Promise.resolve({
      success: true,
      message: 'saved',
    })),
    onUpdate: vi.fn(() => Promise.resolve({
      success: true,
      message: 'updated',
    })),
    onDelete: vi.fn(() => Promise.resolve({
      success: true,
      message: 'deleted',
    })),
  };
  render(<AgentTemplateEditor template={template} systemPrompt={systemPrompt} {...handlers} />);
  return handlers;
}

describe('AgentTemplateEditor', () => {
  it('starts from the template profile with a copy name when the template is built-in', () => {
    renderEditor(buildCafeTemplate());

    expect(screen.getByLabelText('Template name')).toHaveValue('Cafés (copy)');
    expect(screen.getByLabelText(/^Subject/)).toHaveValue('café');
    expect(screen.getByLabelText(/^Audience/)).toHaveValue('coffee drinkers');
    expect(screen.getAllByLabelText('Dimension label').map((input) => input.getAttribute('value'))).toStrictEqual(['Menu & drinks', 'Location', 'Occasion']);
  });

  it('offers only a copy when the template is built-in', () => {
    renderEditor(buildTemplate());

    expect(screen.getByRole('button', { name: 'Save as new template' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Update template' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete template' })).toBeNull();
    expect(screen.getByText(/Built-in templates can\u2019t be edited/)).toBeInTheDocument();
  });

  it('keeps Update disabled until something differs from the saved template', async () => {
    renderEditor(SAVED);
    expect(screen.getByRole('button', { name: 'Update template' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Template name'), ' 2026');

    expect(screen.getByRole('button', { name: 'Update template' })).toBeEnabled();
  });

  it('sends only the changed fields when a saved template is updated', async () => {
    const handlers = renderEditor(SAVED);

    await userEvent.clear(screen.getByLabelText(/^Audience/));
    await userEvent.type(screen.getByLabelText(/^Audience/), 'business travellers');
    await userEvent.click(screen.getByRole('button', { name: 'Update template' }));

    expect(handlers.onUpdate).toHaveBeenCalledWith({ audience: 'business travellers' });
  });

  it('saves a copy derived from the selected template with ids from the labels', async () => {
    const handlers = renderEditor(buildCafeTemplate(), 'An edited prompt for my own café.');

    await userEvent.click(screen.getByRole('button', { name: 'Add dimension' }));
    await userEvent.type(screen.getAllByLabelText('Dimension label')[3], 'Opening hours');
    await userEvent.type(screen.getAllByLabelText('Dimension description')[3], 'late night, early breakfast');
    await userEvent.click(screen.getByRole('button', { name: 'Save as new template' }));

    expect(handlers.onSaveAsNew).toHaveBeenCalledWith({
      name: 'Cafés (copy)',
      description: 'Built-in starting point for cafés and coffee shops.',
      systemPrompt: 'An edited prompt for my own café.',
      baseTemplateId: 'builtin-cafes',
      subject: 'café',
      audience: 'coffee drinkers',
      dimensions: [...buildCafeTemplate().dimensions, {
        id: 'opening_hours',
        label: 'Opening hours',
        description: 'late night, early breakfast',
      }],
    });
  });

  it('shows the derived id while a label is typed', async () => {
    renderEditor(SAVED);

    await userEvent.click(screen.getByRole('button', { name: 'Add dimension' }));
    await userEvent.type(screen.getAllByLabelText('Dimension label')[6], 'Menú & bebidas');

    expect(screen.getByText('id: menu_bebidas')).toBeInTheDocument();
  });

  it('removes a dimension row', async () => {
    renderEditor(buildCafeTemplate());

    await userEvent.click(screen.getByRole('button', { name: 'Remove dimension Occasion' }));

    expect(screen.getAllByLabelText('Dimension label')).toHaveLength(2);
  });

  it('blocks saving and explains the problems when the draft is invalid', async () => {
    const handlers = renderEditor(buildCafeTemplate());

    await userEvent.click(screen.getByRole('button', { name: 'Remove dimension Occasion' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove dimension Location' }));
    await userEvent.clear(screen.getByLabelText(/^Subject/));
    await userEvent.click(screen.getByRole('button', { name: 'Save as new template' }));

    expect(handlers.onSaveAsNew).not.toHaveBeenCalled();
    expect(screen.getByText('Add at least 2 dimensions.')).toBeInTheDocument();
    expect(screen.getByText('Enter the subject (at least 2 characters).')).toBeInTheDocument();
  });

  it('flags a duplicate dimension on its own row', async () => {
    const handlers = renderEditor(SAVED);

    await userEvent.click(screen.getByRole('button', { name: 'Add dimension' }));
    await userEvent.type(screen.getAllByLabelText('Dimension label')[6], 'Audience');
    await userEvent.click(screen.getByRole('button', { name: 'Update template' }));

    expect(handlers.onUpdate).not.toHaveBeenCalled();
    expect(screen.getByText('Duplicate of another dimension (audience).')).toBeInTheDocument();
  });

  it('hands prompt edits to the brief and marks the prompt as edited', async () => {
    const handlers = renderEditor(SAVED, 'You research urban hotels for business travellers!');

    await userEvent.type(screen.getByLabelText('Instructions (system prompt)'), '.');

    expect(handlers.onPromptChange).toHaveBeenCalledWith('You research urban hotels for business travellers!.');
    expect(screen.getByText(/Edited — the run uses this text/)).toBeInTheDocument();
  });

  it('deletes the saved template after confirmation', async () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    const handlers = renderEditor(SAVED);

    await userEvent.click(screen.getByRole('button', { name: 'Delete template' }));

    expect(globalThis.confirm).toHaveBeenCalledWith('Delete template "Urban hotels"? Runs that used it keep their own copy of the prompt.');
    expect(handlers.onDelete).toHaveBeenCalledWith();
  });

  it('keeps the template when the deletion is cancelled', async () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    const handlers = renderEditor(SAVED);

    await userEvent.click(screen.getByRole('button', { name: 'Delete template' }));

    expect(handlers.onDelete).not.toHaveBeenCalled();
  });
});
