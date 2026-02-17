

interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  itemsPerPage: number;
  totalItems: number;
  startIndex: number;
  endIndex: number;
  showAll: boolean;
  onPageChange: (page: number) => void;
  onItemsPerPageChange: (value: number) => void;
}

export const PaginationControls = ({
  currentPage,
  totalPages,
  itemsPerPage,
  totalItems,
  startIndex,
  endIndex,
  showAll,
  onPageChange,
  onItemsPerPageChange,
}: PaginationControlsProps) => {
  return (
    <div className="p-3 sm:p-4 border-b border-gray-200">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-gray-500">Show:</span>
          <select
            value={itemsPerPage}
            onChange={(e) => onItemsPerPageChange(Number(e.target.value))}
            className="px-2 sm:px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={-1}>All ({totalItems})</option>
          </select>
          <span className="text-gray-500 text-xs sm:text-sm">
            {showAll ? `All ${totalItems}` : `${startIndex + 1}-${Math.min(endIndex, totalItems)} of ${totalItems}`}
          </span>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-1 overflow-x-auto">
            <button onClick={() => onPageChange(1)} disabled={currentPage === 1} className="px-2 py-1 text-gray-500 hover:bg-gray-100 rounded disabled:opacity-50 text-xs sm:text-sm">First</button>
            <button onClick={() => onPageChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1} className="px-2 py-1 text-gray-500 hover:bg-gray-100 rounded disabled:opacity-50 text-xs sm:text-sm">Prev</button>
            <span className="px-2 sm:px-3 py-1 text-gray-700 text-xs sm:text-sm">{currentPage}/{totalPages}</span>
            <button onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages} className="px-2 py-1 text-gray-500 hover:bg-gray-100 rounded disabled:opacity-50 text-xs sm:text-sm">Next</button>
            <button onClick={() => onPageChange(totalPages)} disabled={currentPage === totalPages} className="px-2 py-1 text-gray-500 hover:bg-gray-100 rounded disabled:opacity-50 text-xs sm:text-sm">Last</button>
          </div>
        )}
      </div>
    </div>
  );
};