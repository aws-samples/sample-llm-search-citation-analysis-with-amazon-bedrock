import type { ResearchKeyword } from '../../types';
import { ClipboardIcon } from '../ui/ClipboardIcon';

const INTENT_COLORS: Record<string, string> = {
  informational: 'bg-blue-100 text-blue-700',
  commercial: 'bg-purple-100 text-purple-700',
  transactional: 'bg-green-100 text-green-700',
  navigational: 'bg-gray-100 text-gray-700',
};

const COMPETITION_COLORS: Record<string, string> = {
  low: 'text-green-600',
  medium: 'text-yellow-600',
  high: 'text-red-600',
};

const intentColor = (intent: string): string => INTENT_COLORS[intent?.toLowerCase()] ?? 'bg-gray-100 text-gray-600';

const competitionColor = (competition: string): string => COMPETITION_COLORS[competition?.toLowerCase()] ?? 'text-gray-600';

/** Intent badge, competition and relevance bar cells of a research keyword row. */
export const KeywordSignalCells = ({ keyword }: { readonly keyword: ResearchKeyword }) => (
  <>
    <td className="px-6 py-4">
      <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${intentColor(keyword.intent)}`}>
        {keyword.intent}
      </span>
    </td>
    <td className={`px-6 py-4 text-sm font-medium ${competitionColor(keyword.competition)}`}>{keyword.competition}</td>
    <td className="px-6 py-4">
      <div className="flex items-center gap-2">
        <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-gray-900 rounded-full" style={{ width: `${(keyword.relevance ?? 0) * 10}%` }} />
        </div>
        <span className="text-xs text-gray-500">{keyword.relevance}/10</span>
      </div>
    </td>
  </>
);

/** Trailing cell with the copy-to-clipboard button for the row's keyword. */
export const CopyKeywordCell = ({
  keyword, onCopy
}: {
  readonly keyword: string;
  readonly onCopy: (text: string) => void 
}) => (
  <td className="px-6 py-4 text-right">
    <button
      onClick={() => onCopy(keyword)}
      className="text-gray-400 hover:text-gray-600 transition-colors"
      title="Copy keyword"
    >
      <ClipboardIcon className="w-4 h-4" />
    </button>
  </td>
);
