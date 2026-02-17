import {
  render, screen, fireEvent 
} from '@testing-library/react';
import {
  describe, it, expect 
} from 'vitest';
import { PromptEditor } from './PromptEditor';
import { buildProps } from './PromptEditor-fixtures';

describe('PromptEditor', () => {
  it('renders industry selector with current industry selected', () => {
    render(<PromptEditor {...buildProps()} />);
    expect(screen.getByRole('combobox')).toHaveValue('hospitality');
  });

  it('calls onIndustryChange when industry changes', () => {
    const props = buildProps();
    render(<PromptEditor {...props} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'retail' } });
    expect(props.onIndustryChange).toHaveBeenCalledWith('retail');
  });

  it('shows unsaved indicator when prompt modified', () => {
    render(<PromptEditor {...buildProps({ promptModified: true })} />);
    expect(screen.getByText('Unsaved')).toBeInTheDocument();
  });

  it('shows custom indicator for custom prompts', () => {
    render(<PromptEditor {...buildProps()} />);
    expect(screen.getByText('Custom')).toBeInTheDocument();
  });

  it('calls onPromptChange when textarea changes', () => {
    const props = buildProps();
    render(<PromptEditor {...props} />);
    fireEvent.change(screen.getByPlaceholderText('Enter extraction prompt...'), {target: { value: 'New prompt' }});
    expect(props.onPromptChange).toHaveBeenCalledWith('New prompt');
  });

  it('calls onResetToDefault when reset button clicked', () => {
    const props = buildProps();
    render(<PromptEditor {...props} />);
    fireEvent.click(screen.getByText('Reset to Default'));
    expect(props.onResetToDefault).toHaveBeenCalledTimes(1);
  });

  it('displays character count', () => {
    render(<PromptEditor {...buildProps({ currentPrompt: 'test' })} />);
    expect(screen.getByText('4 chars')).toBeInTheDocument();
  });
});