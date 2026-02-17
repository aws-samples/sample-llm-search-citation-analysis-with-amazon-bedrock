import { useState } from 'react';
import type { ContentStudioHistory } from '../../types';
import { Spinner } from '../ui/Spinner';
import { ConfirmModal } from '../ui/Modal';
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
  const [copied, setCopied] = useState(false);
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
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
        <svg className="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
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
          copied={copied}
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
