

interface CitationTableHeaderProps {
  sortBy: 'citations' | 'keywords';
  setSortBy: (sort: 'citations' | 'keywords') => void;
}

export const CitationTableHeader = ({
  sortBy, setSortBy 
}: CitationTableHeaderProps) => {
  return (
    <thead className="bg-gray-50">
      <tr>
        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase w-12">#</th>
        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">URL</th>
        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Domain</th>
        <th 
          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase w-28 cursor-pointer hover:bg-gray-100 transition-colors"
          onClick={() => setSortBy('keywords')}
        >
          <div className="flex items-center gap-1">
            Keywords
            {sortBy === 'keywords' && (
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </div>
        </th>
        <th 
          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase w-28 cursor-pointer hover:bg-gray-100 transition-colors"
          onClick={() => setSortBy('citations')}
        >
          <div className="flex items-center gap-1">
            Citations
            {sortBy === 'citations' && (
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </div>
        </th>
      </tr>
    </thead>
  );
};