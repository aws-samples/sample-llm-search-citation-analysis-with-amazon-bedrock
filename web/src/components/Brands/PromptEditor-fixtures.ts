import { vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { PromptEditor } from './PromptEditor';

type PromptEditorProps = ComponentProps<typeof PromptEditor>;

/** The editor on the hospitality preset with a saved custom prompt; every prop can be overridden. */
export function buildProps(overrides: Partial<PromptEditorProps> = {}): PromptEditorProps {
  return {
    industryName: 'Hospitality',
    hasCustomPrompt: true,
    currentPrompt: 'Test prompt',
    promptModified: false,
    onPromptChange: vi.fn(),
    onResetToDefault: vi.fn(),
    ...overrides,
  };
}
