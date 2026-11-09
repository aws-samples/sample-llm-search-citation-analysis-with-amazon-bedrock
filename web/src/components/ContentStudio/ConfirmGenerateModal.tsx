import {
  useId, useState
} from 'react';
import type { ContentIdea } from '../../types';
import { Modal } from '../ui/Modal';
import { StrokeIcon } from '../ui/StrokeIcon';
import {
  BOLT_PATHS, LIGHTBULB_PATHS
} from '../ui/iconPaths';
import { GROUP_BRIEF_LANGUAGES } from './GroupBriefForm-source';

interface ConfirmGenerateModalProps {
  readonly idea: ContentIdea;
  readonly onConfirm: (outputLanguage: string) => void;
  readonly onCancel: () => void;
}

const FOCUS_RING = 'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-gray-500 dark:focus-visible:ring-offset-gray-800';

/** Asks for the output language and confirms the paid generation of one content idea. */
export function ConfirmGenerateModal({
  idea, onConfirm, onCancel
}: ConfirmGenerateModalProps) {
  const [outputLanguage, setOutputLanguage] = useState('English');
  const titleId = useId();

  return (
    <Modal isOpen onClose={onCancel} labelledBy={titleId} showCloseButton={false}>
      <div className="flex items-start gap-4 pt-2">
        <div className="p-3 bg-gray-100 rounded-full shrink-0">
          <StrokeIcon className="w-6 h-6 text-amber-700 dark:text-amber-300" paths={LIGHTBULB_PATHS} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 id={titleId} className="text-lg font-semibold text-gray-900">Create Content</h3>
          <p className="text-sm text-gray-600 mt-2">
            AI will analyze competitor content and generate optimized content for:
          </p>
          <div className="mt-3 p-3 bg-gray-50 rounded-lg">
            <p className="font-medium text-gray-900 break-words">{idea.title}</p>
            <p className="text-sm text-gray-500 mt-1 break-words">Keyword: {idea.keyword}</p>
            {idea.competitor_urls && idea.competitor_urls.length > 0 && (
              <p className="text-sm text-gray-500">{idea.competitor_urls.length} competitor sources will be analyzed</p>
            )}
          </div>
          <div className="mt-3">
            <label htmlFor="output-language" className="block text-sm font-medium text-gray-700 mb-1">
              Output Language
            </label>
            <select
              id="output-language"
              value={outputLanguage}
              onChange={e => setOutputLanguage(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-gray-900"
            >
              {GROUP_BRIEF_LANGUAGES.map(lang => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            This starts a paid AI model request and may take up to a minute. The result appears under Generated Content.
          </p>
        </div>
      </div>

      <div className="flex gap-3 mt-6 pb-2">
        <button
          type="button"
          onClick={onCancel}
          className={`flex-1 px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors ${FOCUS_RING}`}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onConfirm(outputLanguage)}
          className={`flex-1 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors flex items-center justify-center gap-2 ${FOCUS_RING}`}
        >
          <StrokeIcon className="w-4 h-4" paths={BOLT_PATHS} />
          Generate Content
        </button>
      </div>
    </Modal>
  );
}
