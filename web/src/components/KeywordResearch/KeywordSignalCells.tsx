import type { ResearchKeyword } from '../../types';
import { ClipboardIcon } from '../ui/ClipboardIcon';

const INTENT_COLORS: Record<string, string> = {
  informational: 'bg-blue-100 text-blue-700',
  commercial: 'bg-violet-100 text-violet-700',
  transactional: 'bg-gray-100 text-emerald-700',
  navigational: 'bg-gray-100 text-gray-700',
};

const COMPETITION_COLORS: Record<string, string> = {
  low: 'text-emerald-700',
  medium: 'text-amber-700',
  high: 'text-red-700',
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
          <div className="h-full bg-gray-900 dark:bg-gray-200 rounded-full" style={{ width: `${(keyword.relevance ?? 0) * 10}%` }} />
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
      className="rounded text-gray-500 hover:text-gray-900 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
      title="Copy keyword"
      aria-label="Copy keyword"
    >
      <ClipboardIcon className="w-4 h-4" />
    </button>
  </td>
);
