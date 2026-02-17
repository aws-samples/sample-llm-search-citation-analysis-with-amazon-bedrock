import type { ContentStudioHistory } from '../../types';
import { formatDate } from '../../formatting/dateFormatter';
import { Spinner } from '../ui/Spinner';

interface HistoryListItemProps {
  item: ContentStudioHistory;
  deletingId: string | null;
  onSelect: (item: ContentStudioHistory) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
}

const getStatusIcon = (item: ContentStudioHistory) => {
  if (item.status === 'pending' || item.status === 'generating') {
    return <Spinner size="sm" />;
  }

  if (item.status === 'failed') {
    return (
      <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }

  if (!item.viewed) {
    return (
      <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  }

  return (
    <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
};

const getIconContainerClass = (item: ContentStudioHistory): string => {
  if (item.status === 'pending' || item.status === 'generating') {
    return 'bg-blue-100';
  }
  if (item.status === 'failed') {
    return 'bg-red-100';
  }
  if (!item.viewed) {
    return 'bg-orange-100';
  }
  return 'bg-gray-100';
};

const getContainerClass = (item: ContentStudioHistory): string => {
  const baseClass = 'bg-white rounded-lg border p-4 cursor-pointer hover:shadow-sm transition-all';
  if (!item.viewed && item.status === 'generated') {
    return `${baseClass} border-orange-300 bg-orange-50/30`;
  }
  return `${baseClass} border-gray-200 hover:border-gray-300`;
};

export const HistoryListItem = ({
  item, deletingId, onSelect, onDelete 
}: HistoryListItemProps) => {
  return (
    <div
      key={item.id}
      onClick={() => onSelect(item)}
      className={getContainerClass(item)}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
          <div className={`p-2 rounded-lg shrink-0 ${getIconContainerClass(item)}`}>
            {getStatusIcon(item)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-gray-900 truncate text-sm sm:text-base">
                {item.generated_content?.title ?? item.idea_title}
              </h3>
              <StatusBadge item={item} />
            </div>
            <ItemMetadata item={item} />
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <DeleteButton
            itemId={item.id}
            deletingId={deletingId}
            onDelete={onDelete}
          />
          <svg className="w-5 h-5 text-gray-400 hidden sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>

      <ItemPreview item={item} />
    </div>
  );
};

const StatusBadge = ({ item }: { item: ContentStudioHistory }) => {
  if (!item.viewed && item.status === 'generated') {
    return (
      <span className="px-1.5 py-0.5 text-xs bg-orange-500 text-white rounded font-medium">
        NEW
      </span>
    );
  }

  if (item.status === 'generating') {
    return (
      <span className="px-1.5 py-0.5 text-xs bg-blue-500 text-white rounded font-medium">
        GENERATING
      </span>
    );
  }

  if (item.status === 'failed') {
    return (
      <span className="px-1.5 py-0.5 text-xs bg-red-500 text-white rounded font-medium">
        FAILED
      </span>
    );
  }

  return null;
};

const ItemMetadata = ({ item }: { item: ContentStudioHistory }) => (
  <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-gray-500 mt-1">
    <span className="flex items-center gap-1">
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
      </svg>
      <span className="truncate max-w-[100px] sm:max-w-none">{item.keyword}</span>
    </span>
    <span className="hidden sm:inline">•</span>
    <span>{formatDate(item.created_at)}</span>
    {item.competitor_sources_used > 0 && (
      <>
        <span className="hidden sm:inline">•</span>
        <span>{item.competitor_sources_used} sources</span>
      </>
    )}
  </div>
);

interface DeleteButtonProps {
  itemId: string;
  deletingId: string | null;
  onDelete: (id: string, e: React.MouseEvent) => void;
}

const DeleteButton = ({
  itemId, deletingId, onDelete 
}: DeleteButtonProps) => (
  <button
    onClick={(e) => onDelete(itemId, e)}
    disabled={deletingId === itemId}
    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
    title="Delete"
  >
    {deletingId === itemId ? (
      <Spinner size="sm" />
    ) : (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
    )}
  </button>
);

const ItemPreview = ({ item }: { item: ContentStudioHistory }) => {
  if (item.status === 'generated' && item.generated_content?.meta_description) {
    return (
      <p className="text-sm text-gray-500 mt-3 line-clamp-2">
        {item.generated_content.meta_description}
      </p>
    );
  }

  if (item.status === 'failed' && item.error_message) {
    return (
      <p className="text-sm text-red-600 mt-3">
        Error: {item.error_message}
      </p>
    );
  }

  if (item.status === 'pending' || item.status === 'generating') {
    return (
      <p className="text-sm text-blue-600 mt-3">
        Content is being generated. This may take up to a minute...
      </p>
    );
  }

  return null;
};
