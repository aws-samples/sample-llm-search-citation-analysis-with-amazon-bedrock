import { StrokeIcon } from '../ui/StrokeIcon';
import { DOWNLOAD_PATHS } from '../ui/iconPaths';


interface CitationFiltersProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  minCitations: number | '';
  setMinCitations: (min: number | '') => void;
  setCurrentPage: (page: number) => void;
  onDownloadExcel: () => void;
}

export const CitationFilters = ({
  searchQuery,
  setSearchQuery,
  minCitations,
  setMinCitations,
  setCurrentPage,
  onDownloadExcel,
}: CitationFiltersProps) => {
  const handleClear = () => {
    setSearchQuery('');
    setMinCitations('');
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
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
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
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleClear}
            className="flex-1 sm:flex-none px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
          >
            Clear
          </button>
          <button
            onClick={onDownloadExcel}
            className="flex-1 sm:flex-none px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
          >
            <StrokeIcon className="w-4 h-4" paths={DOWNLOAD_PATHS} />
            <span className="sr-only sm:not-sr-only">Export</span>
          </button>
        </div>
      </div>
    </div>
  );
};