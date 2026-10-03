import { vi } from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ResearchTemplate } from '../../../types';
import { AgentTemplateEditor } from './AgentTemplateEditor';

/** A template save / update / delete handler that succeeds with `message`. */
export function mockTemplateAction(message: string) {
  return vi.fn(() => Promise.resolve({
    success: true,
    message,
  }));
}

export function renderEditor(template: ResearchTemplate, systemPrompt = template.system_prompt) {
  const handlers = {
    onPromptChange: vi.fn(),
    onSaveAsNew: mockTemplateAction('saved'),
    onUpdate: mockTemplateAction('updated'),
    onDelete: mockTemplateAction('deleted'),
  };
  render(<AgentTemplateEditor template={template} systemPrompt={systemPrompt} {...handlers} />);
  return handlers;
}

/** Clicks one of the editor's named buttons ("Update template", "Delete template", ...). */
export async function clickButton(name: string): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name }));
}

/** Adds a dimension row and types `label` into it; `index` is the new row's position. */
export async function addDimensionRow(index: number, label: string): Promise<void> {
  await clickButton('Add dimension');
  await userEvent.type(screen.getAllByLabelText('Dimension label')[index], label);
}
