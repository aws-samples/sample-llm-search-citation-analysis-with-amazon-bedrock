import { vi } from 'vitest';
import type { ComponentProps } from 'react';
import { INDUSTRY_PRESETS } from './IndustrySelector-fixtures';
import type { PromptEditor } from './PromptEditor';

type PromptEditorProps = ComponentProps<typeof PromptEditor>;

/** The editor on the hospitality preset with a saved custom prompt; every prop can be overridden. */
export function buildProps(overrides: Partial<PromptEditorProps> = {}): PromptEditorProps {
  return {
    industry: 'hospitality',
    presets: INDUSTRY_PRESETS,
    industryPrompts: { hospitality: 'Custom hospitality prompt' },
    currentPrompt: 'Test prompt',
    promptModified: false,
    onIndustryChange: vi.fn(),
    onPromptChange: vi.fn(),
    onResetToDefault: vi.fn(),
    ...overrides,
  };
}
