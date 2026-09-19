import type { ReactNode } from 'react';
import { CloseIcon } from '../ui';

interface SuggestionPanelHeaderProps {
  readonly title: ReactNode;
  readonly titleClassName: string;
  /** Extra detail lines rendered between the title and the notes. */
  readonly children?: ReactNode;
  readonly notes: string | undefined;
  readonly notesClassName: string;
  readonly onDismiss: () => void;
}

/**
 * Title row of a Bedrock suggestion panel (sub-brand expansion, competitor
 * discovery): the heading, any detail lines, the model's notes and the
 * dismiss button.
 */
export function SuggestionPanelHeader({
  title, titleClassName, children, notes, notesClassName, onDismiss 
}: SuggestionPanelHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-2">
      <div>
        <h4 className={`text-sm font-medium ${titleClassName}`}>{title}</h4>
        {children}
        {notes && (
          <p className={`text-xs ${notesClassName} mt-1`}>{notes}</p>
        )}
      </div>
      <button onClick={onDismiss} className="text-gray-400 hover:text-gray-600">
        <CloseIcon className="w-4 h-4" />
      </button>
    </div>
  );
}
