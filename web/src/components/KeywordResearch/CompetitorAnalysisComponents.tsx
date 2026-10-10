import type {
  CompetitorAnalysisResult, ExpandedKeywordWithSource, SeoElements
} from '../../types';
import {
  keywordSelectionKey, uniqueResearchKeywords
} from '../../hooks/keywordIdentity';
import { useClipboardCopy } from '../../hooks/useClipboardCopy';
import { safeHref } from '../../infrastructure';
import { Spinner } from '../ui/Spinner';
import { StrokeIcon } from '../ui/StrokeIcon';
import { TabBar } from '../ui/TabBar';
import {
  CHEVRON_RIGHT_PATHS, GLOBE_PATHS 
} from '../ui/iconPaths';
import {
  CopyKeywordCell, KeywordSignalCells
} from './KeywordSignalCells';
import type { KeywordSelectionProps } from './researchRunView';

type SectionId = 'primary' | 'secondary' | 'longtail' | 'gaps';

const sections: ReadonlyArray<{
  id: SectionId;
  label: string 
}> = [
  {
    id: 'primary',
    label: 'Primary Keywords' 
  },
  {
    id: 'secondary',
    label: 'Secondary Keywords' 
  },
  {
    id: 'longtail',
    label: 'Long-tail Keywords' 
  },
  {
    id: 'gaps',
    label: 'Content Gaps' 
  },
];

const getSectionCount = (result: CompetitorAnalysisResult | null, sectionId: SectionId): number => {
  if (!result) return 0;
  const counts: Record<SectionId, number> = {
    primary: result.primary_keywords?.length ?? 0,
    secondary: result.secondary_keywords?.length ?? 0,
    longtail: result.longtail_keywords?.length ?? 0,
    gaps: result.content_gaps?.length ?? 0,
  };
  return counts[sectionId];
};

export const getKeywordsForSection = (
  result: CompetitorAnalysisResult | null,
  sectionId: SectionId
): ExpandedKeywordWithSource[] => {
  if (!result) return [];
  const keywordMap: Record<SectionId, ExpandedKeywordWithSource[] | undefined> = {
    primary: result.primary_keywords,
    secondary: result.secondary_keywords,
    longtail: result.longtail_keywords,
    gaps: result.content_gaps,
  };
  return uniqueResearchKeywords(keywordMap[sectionId] ?? []);
};

interface InputFormProps {
  url: string;
  setUrl: (url: string) => void;
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
}

export const InputForm = ({
  url, setUrl, loading, onSubmit 
}: InputFormProps) => (
  <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
    <h3 className="text-sm font-medium text-gray-900 mb-2">Analyze Competitor Website</h3>
    <label htmlFor="competitor-analysis-url" className="block text-xs text-gray-500 mb-4">
      Enter a competitor's URL to discover keywords they're targeting and find content gaps.
    </label>
    <form onSubmit={onSubmit} className="flex flex-col sm:flex-row gap-3 sm:gap-4">
      <div className="flex-1">
        <input
          id="competitor-analysis-url"
          name="competitor-url"
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://competitor.com"
          className="w-full px-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
        />
      </div>
      <button
        type="submit"
        disabled={loading || !url.trim()}
        className="px-6 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <Spinner size="sm" />
            Analyzing...
          </>
        ) : (
          <>
            <StrokeIcon className="w-4 h-4" paths={GLOBE_PATHS} />
            Analyze
          </>
        )}
      </button>
    </form>
  </div>
);

interface SeoElementRowProps {
  label: string;
  value: string;
  isUrl?: boolean;
}

const SeoElementRow = ({
  label, value, isUrl 
}: SeoElementRowProps) => (
  <div className="flex flex-col sm:flex-row sm:gap-3">
    <span className="font-medium text-gray-500 sm:w-32 shrink-0">{label}:</span>
    {isUrl ? (
      <a 
        href={safeHref(value)} 
        target="_blank" 
        rel="noopener noreferrer"
        className="text-blue-600 hover:underline break-all"
      >
        {value}
      </a>
    ) : (
      <span className="text-gray-700 break-words">{value}</span>
    )}
  </div>
);

/**
 * The `SeoElements` type declares every field, but jobs stored before the
 * backend extracted `h3_tags`, `og_title`, `og_description` and `canonical`
 * carry none of them, so every row treats its field as optional.
 */
type StoredSeoElements = Partial<SeoElements>;

const hasTags = (tags: string[] | undefined): tags is string[] => tags !== undefined && tags.length > 0;

const textRow = (label: string, value: string | undefined, isUrl = false): SeoElementRowProps | null =>
  value ? {
    label,
    value,
    isUrl,
  } : null;

const tagsRow = (label: string, tags: string[] | undefined): SeoElementRowProps | null =>
  hasTags(tags) ? {
    label,
    value: tags.join(' | '),
  } : null;

/** One row per element the page actually had, in display order. */
const seoElementRows = (seoElements: StoredSeoElements): SeoElementRowProps[] => {
  const rows = [
    textRow('Title Tag', seoElements.title),
    textRow('Meta Description', seoElements.meta_description),
    textRow('Meta Keywords', seoElements.meta_keywords),
    tagsRow('H1 Tags', seoElements.h1_tags),
    tagsRow('H2 Tags', seoElements.h2_tags),
    tagsRow('H3 Tags', seoElements.h3_tags?.slice(0, 5)),
    textRow('OG Title', seoElements.og_title),
    textRow('OG Description', seoElements.og_description),
    textRow('Canonical URL', seoElements.canonical, true),
  ];
  return rows.filter((row): row is SeoElementRowProps => row !== null);
};

/** The block only appears when the fetch yielded a title, a description or headings. */
const hasSeoContent = (seoElements: StoredSeoElements): boolean =>
  Boolean(seoElements.title)
  || Boolean(seoElements.meta_description)
  || hasTags(seoElements.h1_tags)
  || hasTags(seoElements.h2_tags);

interface SeoElementsDisplayProps {seoElements: StoredSeoElements;}

export const SeoElementsDisplay = ({ seoElements }: SeoElementsDisplayProps) => {
  if (!hasSeoContent(seoElements)) return null;
  
  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <div className="flex items-center gap-2 text-xs font-medium text-gray-700 mb-3">
        <StrokeIcon className="w-4 h-4 rotate-90" paths={CHEVRON_RIGHT_PATHS} strokeWidth={2} />
        <span>Extracted SEO Elements</span>
        <span className="text-gray-400 font-normal">(actual page data)</span>
      </div>
      
      <div className="space-y-3 text-xs">
        {seoElementRows(seoElements).map((row) => <SeoElementRow key={row.label} {...row} />)}
      </div>
    </div>
  );
};

interface SummaryCardProps {result: CompetitorAnalysisResult;}

export const SummaryCard = ({ result }: SummaryCardProps) => (
  <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
      <div>
        <h3 className="text-sm font-medium text-gray-900">{result.domain}</h3>
        <p className="text-xs text-gray-500 mt-1">Industry: {result.industry}</p>
        {result.page_focus && <p className="text-xs text-gray-500 mt-0.5">Focus: {result.page_focus}</p>}
      </div>
      <div className="text-left sm:text-right">
        <div className="text-2xl font-semibold text-gray-900">{result.keyword_count}</div>
        <div className="text-xs text-gray-500">Total Keywords</div>
      </div>
    </div>
    {result.seo_elements && <SeoElementsDisplay seoElements={result.seo_elements} />}
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mt-6">
      {sections.map((section) => (
        <div key={section.id} className="text-center">
          <div className="text-base sm:text-lg font-semibold text-gray-900">{getSectionCount(result, section.id)}</div>
          <div className="text-xs text-gray-500">{section.label}</div>
        </div>
      ))}
    </div>
  </div>
);

interface SectionTabsProps {
  activeSection: SectionId;
  setActiveSection: (section: SectionId) => void;
  result: CompetitorAnalysisResult;
}

/** One tab per keyword section, each counting its keywords; the first word stands for the label on narrow screens. */
export const SectionTabs = ({
  activeSection, setActiveSection, result 
}: SectionTabsProps) => (
  <TabBar
    label="Keyword sections"
    tabs={sections.map((section) => ({
      id: section.id,
      label: section.label,
      shortLabel: section.label.split(' ')[0],
      badge: (
        <span className="ml-1 sm:ml-2 text-xs bg-gray-100 text-gray-600 px-1.5 sm:px-2 py-0.5 rounded-full">
          {getSectionCount(result, section.id)}
        </span>
      ),
    }))}
    activeId={activeSection}
    onChange={setActiveSection}
    className="px-4 sm:px-6"
  />
);

interface KeywordRowProps extends KeywordSelectionProps {
  keyword: ExpandedKeywordWithSource;
  showOpportunity: boolean;
}

const KeywordRow = ({
  keyword: kw, showOpportunity, selectable = false, selected, onToggle
}: KeywordRowProps) => {
  const { copy } = useClipboardCopy();
  const selectionId = `competitor-keyword-${encodeURIComponent(keywordSelectionKey(kw.keyword))}`;

  return (
    <tr className="hover:bg-gray-50">
      {selectable && (
        <td className="px-6 py-4">
          <label htmlFor={selectionId} className="sr-only">Select {kw.keyword}</label>
          <input
            id={selectionId}
            name="competitor-keywords"
            value={kw.keyword}
            type="checkbox"
            checked={selected?.has(keywordSelectionKey(kw.keyword)) ?? false}
            onChange={() => onToggle?.(kw.keyword)}
            aria-label={`Select ${kw.keyword}`}
            className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
          />
        </td>
      )}
      <td className="px-6 py-4 text-sm text-gray-900">{kw.keyword}</td>
      <KeywordSignalCells keyword={kw} />
      <td className="px-6 py-4">
        {kw.source && <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600">{kw.source}</span>}
      </td>
      {showOpportunity && (
        <td className="px-6 py-4 text-xs text-gray-600 max-w-xs truncate" title={kw.opportunity}>{kw.opportunity}</td>
      )}
      <CopyKeywordCell keyword={kw.keyword} onCopy={(text) => void copy(text)} />
    </tr>
  );
};

interface KeywordsTableProps extends KeywordSelectionProps {
  keywords: ExpandedKeywordWithSource[];
  showOpportunity: boolean;
}

export const KeywordsTable = ({
  keywords, showOpportunity, selectable = false, selected, onToggle
}: KeywordsTableProps) => (
  <div className="overflow-x-auto">
    <table className="w-full">
      <thead className="bg-gray-50">
        <tr>
          {selectable && (
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Select</th>
          )}
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Keyword</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Intent</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Competition</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Relevance</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
          {showOpportunity && <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Opportunity</th>}
          <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200">
        {keywords.length === 0 ? (
          <tr>
            <td
              colSpan={(showOpportunity ? 7 : 6) + (selectable ? 1 : 0)}
              className="px-6 py-8 text-center text-sm text-gray-500"
            >
              No keywords found in this category
            </td>
          </tr>
        ) : (
          keywords.map((kw) => (
            <KeywordRow
              key={keywordSelectionKey(kw.keyword)}
              keyword={kw}
              showOpportunity={showOpportunity}
              selectable={selectable}
              selected={selected}
              onToggle={onToggle}
            />
          ))
        )}
      </tbody>
    </table>
  </div>
);

export type { SectionId };
