import { useState } from 'react';
import type { ResearchKeyword } from '../../types';

interface KeywordResultsTableProps {
  keywords: ResearchKeyword[];
  title: string;
  subtitle?: string;
  compact?: boolean;
}

export const KeywordResultsTable = ({
  keywords, title, subtitle, compact = false 
}: KeywordResultsTableProps) => {
  const [sortBy, setSortBy] = useState<'relevance' | 'competition'>('relevance');
  const [filterIntent, setFilterIntent] = useState<string>('all');

  const getIntentColor = (intent: string) => {
    switch (intent?.toLowerCase()) {
      case 'informational': return 'bg-blue-100 text-blue-700';
      case 'commercial': return 'bg-purple-100 text-purple-700';
      case 'transactional': return 'bg-green-100 text-green-700';
      case 'navigational': return 'bg-gray-100 text-gray-700';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  const getCompetitionColor = (competition: string) => {
    switch (competition?.toLowerCase()) {
      case 'low': return 'text-green-600';
      case 'medium': return 'text-yellow-600';
      case 'high': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const filteredKeywords = keywords.filter((kw) => 
    filterIntent === 'all' || kw.intent?.toLowerCase() === filterIntent
  );

  const sortedKeywords = [...filteredKeywords].sort((a, b) => {
    if (sortBy === 'relevance') return (b.relevance ?? 0) - (a.relevance ?? 0);
    const compOrder: Record<string, number> = {
      low: 1,
      medium: 2,
      high: 3 
    };
    const aComp = a.competition?.toLowerCase() ?? '';
    const bComp = b.competition?.toLowerCase() ?? '';
    return (compOrder[aComp] ?? 2) - (compOrder[bComp] ?? 2);
  });

  if (keywords.length === 0) return null;

  return (
    <div className={compact ? '' : 'bg-white rounded-lg border border-gray-200'}>
      {/* Header */}
      <div className={`${compact ? 'py-3' : 'px-4 sm:px-6 py-4 border-b border-gray-200'} flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3`}>
        <div>
          <h3 className="text-sm font-medium text-gray-900">{title}</h3>
          {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <select
            value={filterIntent}
            onChange={(e) => setFilterIntent(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none flex-1 sm:flex-none"
          >
            <option value="all">All Intents</option>
            <option value="informational">Informational</option>
            <option value="commercial">Commercial</option>
            <option value="transactional">Transactional</option>
            <option value="navigational">Navigational</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => {
              const value = e.target.value;
              if (value === 'relevance' || value === 'competition') {
                setSortBy(value);
              }
            }}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none flex-1 sm:flex-none"
          >
            <option value="relevance">Sort by Relevance</option>
            <option value="competition">Sort by Competition</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Keyword</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Intent</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Competition</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Relevance</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {sortedKeywords.map((kw) => (
              <tr key={kw.keyword} className="hover:bg-gray-50">
                <td className="px-6 py-4 text-sm text-gray-900">{kw.keyword}</td>
                <td className="px-6 py-4">
                  <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${getIntentColor(kw.intent)}`}>
                    {kw.intent}
                  </span>
                </td>
                <td className={`px-6 py-4 text-sm font-medium ${getCompetitionColor(kw.competition)}`}>
                  {kw.competition}
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gray-900 rounded-full" 
                        style={{ width: `${(kw.relevance ?? 0) * 10}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500">{kw.relevance}/10</span>
                  </div>
                </td>
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
