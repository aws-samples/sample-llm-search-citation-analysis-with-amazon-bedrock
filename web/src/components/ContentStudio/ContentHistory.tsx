import { useState } from 'react';
import type { ContentStudioHistory } from '../../types';
import { useClipboardCopy } from '../../hooks/useClipboardCopy';
import { Spinner } from '../ui/Spinner';
import { ConfirmModal } from '../ui/Modal';
import { CollectionIcon } from '../ui';
import { ContentDetailModal } from './ContentDetailModal';
import { HistoryListItem } from './HistoryListItem';

interface ContentHistoryProps {
  history: ContentStudioHistory[];
  loading: boolean;
  onDelete: (id: string) => Promise<boolean>;
  onMarkViewed: (id: string) => Promise<boolean>;
}

export const ContentHistory = ({
  history, loading, onDelete, onMarkViewed
}: ContentHistoryProps) => {
  const [selectedItem, setSelectedItem] = useState<ContentStudioHistory | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const {
    copied, copy
  } = useClipboardCopy();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const handleDeleteClick = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingDeleteId(id);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    if (!pendingDeleteId) return;
    setDeletingId(pendingDeleteId);
    await onDelete(pendingDeleteId);
    setDeletingId(null);
    setPendingDeleteId(null);
  };

  const handleCopy = async (text: string) => {
    await copy(text);
  };

  const handleSelectItem = async (item: ContentStudioHistory) => {
    setSelectedItem(item);
    if (!item.viewed && item.status === 'generated') {
      await onMarkViewed(item.id);
    }
  };

  const handleCloseDeleteConfirm = () => {
    setShowDeleteConfirm(false);
    setPendingDeleteId(null);
  };

  if (loading && history.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <Spinner size="lg" className="mx-auto mb-4" />
        Loading content history...
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <CollectionIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />
        <p>No generated content yet.</p>
        <p className="text-sm mt-1">Generate content from the Ideas tab to see it here.</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {history.map(item => (
          <HistoryListItem
            key={item.id}
            item={item}
            deletingId={deletingId}
            onSelect={handleSelectItem}
            onDelete={handleDeleteClick}
          />
        ))}
      </div>

      {selectedItem && (
        <ContentDetailModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onCopy={handleCopy}
          copied={copied !== null}
        />
      )}

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={handleCloseDeleteConfirm}
        onConfirm={handleConfirmDelete}
        title="Delete Content"
        message="Are you sure you want to delete this content? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        confirmVariant="danger"
      />
    </>
  );
};
