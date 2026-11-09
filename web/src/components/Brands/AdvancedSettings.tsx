import type { ComponentProps } from 'react';
import { Disclosure } from '../ui/Disclosure';
import { ExtractionOptions } from './ExtractionOptions';
import { PromptEditor } from './PromptEditor';
import { TagInput } from './TagInput';

interface CustomEntityTypesProps {
  readonly types: string[];
  readonly draft: string;
  readonly onDraftChange: (value: string) => void;
  readonly onAdd: () => void;
  readonly onRemove: (type: string) => void;
}

interface AdvancedSettingsProps {
  readonly options: ComponentProps<typeof ExtractionOptions>;
  /** Set for the Custom industry only, which names its own entity types. */
  readonly entityTypes: CustomEntityTypesProps | null;
  readonly prompt: ComponentProps<typeof PromptEditor>;
}

/** Extraction options, custom entity types and the prompt, collapsed under one "Advanced" heading. */
export function AdvancedSettings({
  options, entityTypes, prompt
}: AdvancedSettingsProps) {
  return (
    <section className="border-t border-gray-200 pt-6">
      <Disclosure title="Advanced: extraction options and prompt" headingLevel={3} headingClassName="text-base font-semibold text-gray-900">
        <div className="space-y-6">
          <p className="max-w-3xl text-sm text-gray-600">
            How the model reads each AI answer. The defaults suit most brands.
          </p>
          <ExtractionOptions {...options} />
          {entityTypes && (
            <div>
              <label htmlFor="new-entity-type" className="mb-1 block text-sm font-semibold text-gray-900">Custom entity types</label>
              <TagInput
                items={entityTypes.types}
                draft={entityTypes.draft}
                onDraftChange={entityTypes.onDraftChange}
                onCommit={entityTypes.onAdd}
                onRemove={entityTypes.onRemove}
                inputId="new-entity-type"
                inputLabel="Add custom entity type"
                placeholder="Add entity type"
              />
            </div>
          )}
          <PromptEditor {...prompt} />
        </div>
      </Disclosure>
    </section>
  );
}
