import type {
  CompetitorAnalysisResult, ExpandedKeywordWithSource 
} from '../../types';
import { Spinner } from '../ui/Spinner';

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

const getIntentColor = (intent: string): string => {
  const colors: Record<string, string> = {
    informational: 'bg-blue-100 text-blue-700',
    commercial: 'bg-purple-100 text-purple-700',
    transactional: 'bg-green-100 text-green-700',
    navigational: 'bg-gray-100 text-gray-700',
  };
  return colors[intent?.toLowerCase()] ?? 'bg-gray-100 text-gray-600';
};

const getCompetitionColor = (competition: string): string => {
  const colors: Record<string, string> = {
    low: 'text-green-600',
    medium: 'text-yellow-600',
    high: 'text-red-600',
  };
  return colors[competition?.toLowerCase()] ?? 'text-gray-600';
};

export const getSectionCount = (result: CompetitorAnalysisResult | null, sectionId: SectionId): number => {
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
  return keywordMap[sectionId] ?? [];
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
    <p className="text-xs text-gray-500 mb-4">
      Enter a competitor's URL to discover keywords they're targeting and find content gaps.
    </p>
    <form onSubmit={onSubmit} className="flex flex-col sm:flex-row gap-3 sm:gap-4">
      <div className="flex-1">
        <input
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
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
              />
            </svg>
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
        href={value} 
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

interface SeoElementsDisplayProps {seoElements: NonNullable<CompetitorAnalysisResult['seo_elements']>;}

const SeoElementsDisplay = ({ seoElements }: SeoElementsDisplayProps) => {
  const hasContent = seoElements.title || seoElements.meta_description || 
    seoElements.h1_tags?.length > 0 || seoElements.h2_tags?.length > 0;
  
  if (!hasContent) return null;
  
  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <div className="flex items-center gap-2 text-xs font-medium text-gray-700 mb-3">
        <svg className="w-4 h-4 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span>Extracted SEO Elements</span>
        <span className="text-gray-400 font-normal">(actual page data)</span>
      </div>
      
      <div className="space-y-3 text-xs">
        {seoElements.title && <SeoElementRow label="Title Tag" value={seoElements.title} />}
        {seoElements.meta_description && <SeoElementRow label="Meta Description" value={seoElements.meta_description} />}
        {seoElements.meta_keywords && <SeoElementRow label="Meta Keywords" value={seoElements.meta_keywords} />}
        {seoElements.h1_tags?.length > 0 && <SeoElementRow label="H1 Tags" value={seoElements.h1_tags.join(' | ')} />}
        {seoElements.h2_tags?.length > 0 && <SeoElementRow label="H2 Tags" value={seoElements.h2_tags.join(' | ')} />}
        {seoElements.h3_tags?.length > 0 && <SeoElementRow label="H3 Tags" value={seoElements.h3_tags.slice(0, 5).join(' | ')} />}
        {seoElements.og_title && <SeoElementRow label="OG Title" value={seoElements.og_title} />}
        {seoElements.og_description && <SeoElementRow label="OG Description" value={seoElements.og_description} />}
        {seoElements.canonical && <SeoElementRow label="Canonical URL" value={seoElements.canonical} isUrl />}
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

export const SectionTabs = ({
  activeSection, setActiveSection, result 
}: SectionTabsProps) => (
  <div className="border-b border-gray-200 overflow-x-auto">
    <nav className="flex min-w-max">
      {sections.map((section) => (
        <button
          key={section.id}
          onClick={() => setActiveSection(section.id)}
          className={`flex-1 min-w-[100px] px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeSection === section.id
              ? 'border-gray-900 text-gray-900'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <span className="hidden sm:inline">{section.label}</span>
          <span className="sm:hidden">{section.label.split(' ')[0]}</span>
          <span className="ml-1 sm:ml-2 text-xs bg-gray-100 text-gray-600 px-1.5 sm:px-2 py-0.5 rounded-full">
            {getSectionCount(result, section.id)}
          </span>
        </button>
      ))}
    </nav>
  </div>
);

interface KeywordRowProps {
  keyword: ExpandedKeywordWithSource;
  showOpportunity: boolean;
}

const KeywordRow = ({
  keyword: kw, showOpportunity 
}: KeywordRowProps) => (
  <tr className="hover:bg-gray-50">
    <td className="px-6 py-4 text-sm text-gray-900">{kw.keyword}</td>
    <td className="px-6 py-4">
      <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${getIntentColor(kw.intent)}`}>
        {kw.intent}
      </span>
    </td>
    <td className={`px-6 py-4 text-sm font-medium ${getCompetitionColor(kw.competition)}`}>{kw.competition}</td>
    <td className="px-6 py-4">
      <div className="flex items-center gap-2">
        <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-gray-900 rounded-full" style={{ width: `${(kw.relevance ?? 0) * 10}%` }} />
        </div>
        <span className="text-xs text-gray-500">{kw.relevance}/10</span>
      </div>
    </td>
    <td className="px-6 py-4">
      {kw.source && <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600">{kw.source}</span>}
    </td>
    {showOpportunity && (
      <td className="px-6 py-4 text-xs text-gray-600 max-w-xs truncate" title={kw.opportunity}>{kw.opportunity}</td>
    )}
    <td className="px-6 py-4 text-right">
      <button
        onClick={() => navigator.clipboard.writeText(kw.keyword)}
        className="text-gray-400 hover:text-gray-600 transition-colors"
        title="Copy keyword"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      </button>
    </td>
  </tr>
);

interface KeywordsTableProps {
  keywords: ExpandedKeywordWithSource[];
  showOpportunity: boolean;
}

export const KeywordsTable = ({
  keywords, showOpportunity 
}: KeywordsTableProps) => (
  <div className="overflow-x-auto">
    <table className="w-full">
      <thead className="bg-gray-50">
        <tr>
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
            <td colSpan={showOpportunity ? 7 : 6} className="px-6 py-8 text-center text-sm text-gray-500">
              No keywords found in this category
            </td>
          </tr>
        ) : (
          keywords.map((kw) => <KeywordRow key={kw.keyword} keyword={kw} showOpportunity={showOpportunity} />)
        )}
      </tbody>
    </table>
  </div>
);

export type { SectionId };
