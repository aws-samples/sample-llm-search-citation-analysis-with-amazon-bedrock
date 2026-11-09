import {
  render, screen, fireEvent 
} from '@testing-library/react';
import {
  describe, it, expect 
} from 'vitest';
import { PromptEditor } from './PromptEditor';
import { buildProps } from './PromptEditor-fixtures';

/** Renders the editor from `buildProps(overrides)` and returns those props (with their spies). */
function renderPromptEditor(overrides: Parameters<typeof buildProps>[0] = {}) {
  const props = buildProps(overrides);
  render(<PromptEditor {...props} />);
  return props;
}

describe('PromptEditor', () => {
  it('names the industry whose prompt it edits', () => {
    renderPromptEditor();
    expect(screen.getByLabelText('Extraction prompt for Hospitality')).toHaveValue('Test prompt');
  });

  it('leaves the industry choice to the form header', () => {
    renderPromptEditor();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('shows unsaved indicator when prompt modified', () => {
    renderPromptEditor({ promptModified: true });
    expect(screen.getByText('Unsaved')).toBeInTheDocument();
  });

  it('shows custom indicator for custom prompts', () => {
    renderPromptEditor();
    expect(screen.getByText('Custom')).toBeInTheDocument();
  });

  it('shows no custom indicator for the preset prompt', () => {
    renderPromptEditor({ hasCustomPrompt: false });
    expect(screen.queryByText('Custom')).not.toBeInTheDocument();
  });

  it('calls onPromptChange when textarea changes', () => {
    const props = renderPromptEditor();
    fireEvent.change(screen.getByPlaceholderText('Enter extraction prompt...'), {target: { value: 'New prompt' }});
    expect(props.onPromptChange).toHaveBeenCalledWith('New prompt');
  });

  it('calls onResetToDefault when reset button clicked', () => {
    const props = renderPromptEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    expect(props.onResetToDefault).toHaveBeenCalledTimes(1);
  });

  it('displays character count', () => {
    renderPromptEditor({ currentPrompt: 'test' });
    expect(screen.getByText('4 chars')).toBeInTheDocument();
  });
});
