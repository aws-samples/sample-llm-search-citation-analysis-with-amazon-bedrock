import { vi } from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  KeywordGroup, ResearchTemplate
} from '../../../types';
import { AgentBriefForm } from './AgentBriefForm';
import {
  buildCafeTemplate, buildSavedTemplate, buildTemplate
} from './agent-fixtures';
import {
  clickButton, mockTemplateAction
} from './AgentTemplateEditor-fixtures';

const GROUPS: KeywordGroup[] = [
  {
    id: 'g2',
    name: 'Zaragoza',
    description: '',
    keyword_count: 4,
    created_at: '',
    updated_at: '',
  },
  {
    id: 'g1',
    name: 'A Coruña',
    description: '',
    keyword_count: 12,
    created_at: '',
    updated_at: '',
  },
];

export const TEMPLATES = [buildTemplate(), buildCafeTemplate(), buildSavedTemplate()];

export const SAVED_COPY = buildCafeTemplate({
  id: 't9',
  name: 'Cafés (copy)',
  builtin: false,
});

export const DISCLOSURE = 'Customise the instructions or create your own template';

export function renderBriefForm() {
  const handlers = {
    onStart: vi.fn(() => Promise.resolve(null)),
    onSaveTemplate: vi.fn(() => Promise.resolve({
      success: true,
      message: 'Template "Cafés (copy)" saved',
      template: SAVED_COPY,
    })),
    onUpdateTemplate: mockTemplateAction('updated'),
    onDeleteTemplate: mockTemplateAction('Template deleted'),
  };
  const form = (templates: ResearchTemplate[]) => (
    <AgentBriefForm groups={GROUPS} templates={templates} templatesLoading={false} starting={false} {...handlers} />
  );
  const { rerender } = render(form(TEMPLATES));
  return {
    ...handlers,
    rerenderWith: (templates: ResearchTemplate[]) => rerender(form(templates)),
  };
}

export function getTemplateSelect(): HTMLSelectElement {
  return screen.getByLabelText<HTMLSelectElement>('Industry template');
}

export function getPromptTextarea(): HTMLTextAreaElement {
  return screen.getByLabelText<HTMLTextAreaElement>('Instructions (system prompt)');
}

export async function fillSeedAndStart(seed: string): Promise<void> {
  await userEvent.type(screen.getByLabelText(/\(or seed\)/), seed);
  await clickButton('Start research');
}

export async function selectTemplate(templateId: string): Promise<void> {
  await userEvent.selectOptions(getTemplateSelect(), templateId);
}

/** Expands the template editor disclosure under the brief. */
export async function openInstructions(): Promise<void> {
  await userEvent.click(screen.getByText(DISCLOSURE));
}

export const queryResetButtonElement = () => screen.queryByRole('button', { name: 'Reset to template' });
