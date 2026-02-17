import { useState } from 'react';
import type { KeywordExpansionResult } from '../../types';
import { KeywordResultsTable } from './KeywordResultsTable';
import { Spinner } from '../ui/Spinner';

interface KeywordExpansionProps {
  onExpand: (seedKeyword: string, industry: string, count: number) => Promise<void>;
  loading: boolean;
  result: KeywordExpansionResult | null;
  error: string | null;
}

const INDUSTRIES = [
  {
    value: 'general',
    label: 'General' 
  },
  {
    value: 'hotels',
    label: 'Hotels & Hospitality' 
  },
  {
    value: 'restaurants',
    label: 'Restaurants & Food' 
  },
  {
    value: 'airlines',
    label: 'Airlines & Travel' 
  },
  {
    value: 'retail',
    label: 'Retail & E-commerce' 
  },
  {
    value: 'fashion',
    label: 'Fashion & Apparel' 
  },
  {
    value: 'automotive',
    label: 'Automotive' 
  },
  {
    value: 'technology',
    label: 'Technology & SaaS' 
  },
  {
    value: 'finance',
    label: 'Finance & Banking' 
  },
  {
    value: 'healthcare',
    label: 'Healthcare' 
  },
  {
    value: 'real-estate',
    label: 'Real Estate' 
  },
];

export const KeywordExpansion = ({
  onExpand, loading, result, error 
}: KeywordExpansionProps) => {
  const [seedKeyword, setSeedKeyword] = useState('');
  const [industry, setIndustry] = useState('general');
  const [count, setCount] = useState(20);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!seedKeyword.trim()) return;
    await onExpand(seedKeyword.trim(), industry, count);
  };

  return (
    <div className="space-y-6">
      {/* Input Form */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-900 mb-4">Find Related Keywords</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm text-gray-600 mb-1">Seed Keyword</label>
              <input
                type="text"
                value={seedKeyword}
                onChange={(e) => setSeedKeyword(e.target.value)}
                placeholder="e.g., best hotels in Barcelona"
                className="w-full px-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Industry</label>
              <select
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                className="w-full px-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
              >
                {INDUSTRIES.map((ind) => (
                  <option key={ind.value} value={ind.value}>{ind.label}</option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-4">
            <div className="w-full sm:w-auto">
              <label className="block text-sm text-gray-600 mb-1">Number of Keywords</label>
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="w-full sm:w-auto px-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={30}>30</option>
                <option value={50}>50</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={loading || !seedKeyword.trim()}
              className="w-full sm:w-auto px-6 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Spinner size="sm" />
                  Expanding...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Find Keywords
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Results */}
      {result?.keywords && result.keywords.length > 0 && (
        <KeywordResultsTable
          keywords={result.keywords}
          title={`${result.keyword_count} keywords for "${result.seed_keyword}"`}
          subtitle={`Industry: ${result.industry}`}
        />
      )}
    </div>
  );
};
