import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  describe, expect, it, vi
} from 'vitest';
import { renderBriefForm } from './AgentBriefForm-fixtures';
import { AgentTemplateEditor } from './AgentTemplateEditor';
import {
  buildCafeTemplate, HOTEL_DIMENSIONS
} from './agent-fixtures';

const otherCodeFieldFixtures = [
  {
    selectLabel: 'Market (country)',
    codeLabel: 'Market (country) code',
    expectedId: 'research-agent-country-other-code',
    expectedName: 'country-other-code',
  },
  {
    selectLabel: 'Language',
    codeLabel: 'Language code',
    expectedId: 'research-agent-language-other-code',
    expectedName: 'language-other-code',
  },
];

describe('Research agent form fields', () => {
  it('exposes stable checkbox metadata when dimensions render', () => {
    renderBriefForm();

    const dimensionCheckboxes = screen.getAllByRole<HTMLInputElement>('checkbox');
    const expectedCheckboxIds = HOTEL_DIMENSIONS.map((dimension) => `research-agent-dimension-${dimension.id}`);
    expect(dimensionCheckboxes.map((checkbox) => checkbox.id)).toStrictEqual(expectedCheckboxIds);
    expect(dimensionCheckboxes.map((checkbox) => checkbox.name)).toStrictEqual(HOTEL_DIMENSIONS.map(() => 'dimensions'));
    expect(dimensionCheckboxes.map((checkbox) => checkbox.value)).toStrictEqual(HOTEL_DIMENSIONS.map((dimension) => dimension.id));
    expect(HOTEL_DIMENSIONS.map((dimension) => screen.getByText(dimension.label).closest('label')?.htmlFor)).toStrictEqual(expectedCheckboxIds);
  });

  it.each(otherCodeFieldFixtures)('uses semantic metadata when $selectLabel switches to Other code', async ({
    selectLabel, codeLabel, expectedId, expectedName
  }) => {
    renderBriefForm();

    await userEvent.selectOptions(screen.getByLabelText(selectLabel), 'other');

    const otherCodeField = screen.getByLabelText(codeLabel);
    expect(otherCodeField).toHaveAttribute('id', expectedId);
    expect(otherCodeField).toHaveAttribute('name', expectedName);
  });

  it('uses complete row-key metadata when template dimensions render', async () => {
    const template = buildCafeTemplate();
    render(
      <AgentTemplateEditor
        template={template}
        systemPrompt={template.system_prompt}
        onPromptChange={vi.fn()}
        onSaveAsNew={vi.fn(() => Promise.resolve({
          success: true,
          message: 'saved',
        }))}
        onUpdate={vi.fn(() => Promise.resolve({
          success: true,
          message: 'updated',
        }))}
        onDelete={vi.fn(() => Promise.resolve({
          success: true,
          message: 'deleted',
        }))}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add dimension' }));

    const dimensionLabelFields = screen.getAllByLabelText('Dimension label');
    const dimensionDescriptionFields = screen.getAllByLabelText('Dimension description');
    const expectedRowKeys = ['menu', 'location', 'occasion', 'new-1'];
    expect(dimensionLabelFields.map((field) => field.id)).toStrictEqual(expectedRowKeys.map((key) => `template-dimension-${key}-label`));
    expect(dimensionDescriptionFields.map((field) => field.id)).toStrictEqual(expectedRowKeys.map((key) => `template-dimension-${key}-description`));
    expect(dimensionLabelFields.map((field) => field.getAttribute('name'))).toStrictEqual(expectedRowKeys.map(() => 'dimension-label'));
    expect(dimensionDescriptionFields.map((field) => field.getAttribute('name'))).toStrictEqual(expectedRowKeys.map(() => 'dimension-description'));
  });

  it('keeps custom-code metadata unique when country and language are both Other', async () => {
    renderBriefForm();

    await userEvent.selectOptions(screen.getByLabelText('Market (country)'), 'other');
    await userEvent.selectOptions(screen.getByLabelText('Language'), 'other');

    const otherCodeFields = [
      screen.getByLabelText('Market (country) code'),
      screen.getByLabelText('Language code'),
    ];
    expect(otherCodeFields.map((field) => field.id)).toStrictEqual([
      'research-agent-country-other-code',
      'research-agent-language-other-code',
    ]);
    expect(new Set(otherCodeFields.map((field) => field.id)).size).toBe(2);
  });
});
