import {
  render, screen, fireEvent 
} from '@testing-library/react';
import {
  describe, it, expect 
} from 'vitest';
import { PromptEditor } from './PromptEditor';
import { buildProps } from './PromptEditor-fixtures';
import { chooseRetailIndustry } from './IndustrySelector-fixtures';

/** Renders the editor from `buildProps(overrides)` and returns those props (with their spies). */
function renderPromptEditor(overrides: Parameters<typeof buildProps>[0] = {}) {
  const props = buildProps(overrides);
  render(<PromptEditor {...props} />);
  return props;
}

describe('PromptEditor', () => {
  it('renders industry selector with current industry selected', () => {
    renderPromptEditor();
    expect(screen.getByRole('combobox')).toHaveValue('hospitality');
  });

  it('calls onIndustryChange when industry changes', () => {
    const props = renderPromptEditor();
    chooseRetailIndustry();
    expect(props.onIndustryChange).toHaveBeenCalledWith('retail');
  });

  it('shows unsaved indicator when prompt modified', () => {
    renderPromptEditor({ promptModified: true });
    expect(screen.getByText('Unsaved')).toBeInTheDocument();
  });

  it('shows custom indicator for custom prompts', () => {
    renderPromptEditor();
    expect(screen.getByText('Custom')).toBeInTheDocument();
  });

  it('calls onPromptChange when textarea changes', () => {
    const props = renderPromptEditor();
    fireEvent.change(screen.getByPlaceholderText('Enter extraction prompt...'), {target: { value: 'New prompt' }});
    expect(props.onPromptChange).toHaveBeenCalledWith('New prompt');
  });

  it('calls onResetToDefault when reset button clicked', () => {
    const props = renderPromptEditor();
    fireEvent.click(screen.getByText('Reset to Default'));
    expect(props.onResetToDefault).toHaveBeenCalledTimes(1);
  });

  it('displays character count', () => {
    renderPromptEditor({ currentPrompt: 'test' });
    expect(screen.getByText('4 chars')).toBeInTheDocument();
  });
});
