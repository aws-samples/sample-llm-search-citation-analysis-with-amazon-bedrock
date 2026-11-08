import type { ReactNode } from 'react';
import type { ContentTypeFilter } from '../../exporters/citationParser';

const CONTENT_TYPE_OPTIONS: ReadonlyArray<readonly [ContentTypeFilter, string]> = [
  ['all', 'All types'],
  ['page', 'Pages'],
  ['video', 'Videos'],
];

function toContentTypeFilter(value: string): ContentTypeFilter {
  return CONTENT_TYPE_OPTIONS.find(([option]) => option === value)?.[0] ?? 'all';
}

interface CitationFiltersProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  minCitations: number | '';
  setMinCitations: (min: number | '') => void;
  contentType: ContentTypeFilter;
  setContentType: (contentType: ContentTypeFilter) => void;
  setCurrentPage: (page: number) => void;
  /** The view's "Export all" (its full list with these filters). */
  exportButton: ReactNode;
}

export const CitationFilters = ({
  searchQuery,
  setSearchQuery,
  minCitations,
  setMinCitations,
  contentType,
  setContentType,
  setCurrentPage,
  exportButton,
}: CitationFiltersProps) => {
  const handleClear = () => {
    setSearchQuery('');
    setMinCitations('');
    setContentType('all');
    setCurrentPage(1);
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 sm:items-end">
        <div className="flex-1">
          <label htmlFor="citation-url-filter" className="block text-sm font-medium text-gray-700 mb-1">Search URL</label>
          <input
            type="text"
            id="citation-url-filter"
            name="citation-url-filter"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Filter by URL..."
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-gray-900"
          />
        </div>
        <div className="w-full sm:w-36">
          <label htmlFor="citation-type-filter" className="block text-sm font-medium text-gray-700 mb-1">Type</label>
          <select
            id="citation-type-filter"
            name="citation-type-filter"
            value={contentType}
            onChange={(e) => {
              setContentType(toContentTypeFilter(e.target.value));
              setCurrentPage(1);
            }}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-hidden focus:ring-2 focus:ring-gray-900"
          >
            {CONTENT_TYPE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div className="w-full sm:w-32">
          <label htmlFor="citation-min-filter" className="block text-sm font-medium text-gray-700 mb-1">Min Citations</label>
          <input
            type="number"
            id="citation-min-filter"
            name="citation-min-filter"
            value={minCitations}
            onChange={(e) => {
              setMinCitations(e.target.value ? parseInt(e.target.value) : '');
              setCurrentPage(1);
            }}
            placeholder="Any"
            min={1}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-gray-900"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleClear}
            className="flex-1 sm:flex-none px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
          >
            Clear
          </button>
          {exportButton}
        </div>
      </div>
    </div>
  );
};
