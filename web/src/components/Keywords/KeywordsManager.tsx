import { useState } from 'react';
import {
  apiDelete, apiPost, apiPut
} from '../../api/client';
import type { Keyword } from '../../types';
import { useAlertModal } from '../../hooks/useAlertModal';
import {
  ConfirmModal, AlertModal
} from '../ui/Modal';
import {
  KeywordInputSection,
  KeywordList,
} from './KeywordsManagerComponents';
import {
  CREATE_ERROR_MESSAGE,
  UPDATE_ERROR_MESSAGE,
  DELETE_ERROR_MESSAGE,
  buildBulkMessage,
  collectBulkResults,
  getBulkAlert,
  getSafeErrorMessage,
  isDuplicateKeyword,
  parseBulkKeywords,
  parseKeywordResponse,
  processBulkKeyword,
} from './keywordEntry';
import type { BulkKeywordResult } from './keywordEntry';

interface KeywordsManagerProps {
  keywords: Keyword[];
  setKeywords: (keywords: Keyword[]) => void;
}

export const KeywordsManager = ({
  keywords, setKeywords
}: KeywordsManagerProps) => {
  const [newKeyword, setNewKeyword] = useState('');
  const [bulkKeywords, setBulkKeywords] = useState('');
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);

  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    keywordId: string
  }>({
    isOpen: false,
    keywordId: '',
  });
  const {
    alertModal, showAlert, closeAlert
  } = useAlertModal();

  const addKeyword = async () => {
    const trimmed = newKeyword.trim();
    if (!trimmed) return;

    if (isDuplicateKeyword(trimmed, keywords)) {
      showAlert('Duplicate Keyword', `"${trimmed}" already exists`, 'error');
      return;
    }

    setSaving(true);
    try {
      const response = await apiPost<unknown>(
        '/keywords',
        { keyword: trimmed },
        { allowStructured4xx: true }
      );
      const data = parseKeywordResponse(response);
      setKeywords([data, ...keywords]);
      setNewKeyword('');
    } catch (error) {
      console.error('Error adding keyword:', error);
      showAlert('Error', getSafeErrorMessage(error, CREATE_ERROR_MESSAGE), 'error');
    } finally {
      setSaving(false);
    }
  };

  const addBulkKeywords = async () => {
    if (!bulkKeywords.trim()) return;

    const keywordList = parseBulkKeywords(bulkKeywords);
    if (keywordList.length === 0) return;

    const duplicates = keywordList.filter((keyword) => isDuplicateKeyword(keyword, keywords));
    const newKeywordsToAdd = keywordList.filter((keyword) => !isDuplicateKeyword(keyword, keywords));

    if (newKeywordsToAdd.length === 0) {
      showAlert('All Duplicates', `All keywords already exist: ${duplicates.join(', ')}`, 'error');
      return;
    }

    setSaving(true);
    try {
      const results: BulkKeywordResult[] = [];
      for (const keyword of newKeywordsToAdd) {
        results.push(await processBulkKeyword(keyword));
      }

      const {
        addedKeywords, failures
      } = collectBulkResults(results);

      if (addedKeywords.length > 0) {
        setKeywords([...addedKeywords, ...keywords]);
      }
      setBulkKeywords(failures.map(({ keyword }) => keyword).join('\n'));

      const alert = getBulkAlert(addedKeywords.length, failures.length);
      showAlert(
        alert.title,
        buildBulkMessage(addedKeywords.length, duplicates.length, failures),
        alert.variant
      );
    } finally {
      setSaving(false);
    }
  };

  const updateKeyword = async (id: string) => {
    const trimmed = editText.trim();
    if (!trimmed) return;

    if (isDuplicateKeyword(trimmed, keywords, id)) {
      showAlert('Duplicate Keyword', `"${trimmed}" already exists`, 'error');
      return;
    }

    setSaving(true);
    try {
      const response = await apiPut<unknown>(
        `/keywords/${id}`,
        { keyword: trimmed },
        { allowStructured4xx: true }
      );
      const data = parseKeywordResponse(response);
      setKeywords(keywords.map((item) => (item.id === id ? data : item)));
      setEditingId(null);
      setEditText('');
    } catch (error) {
      console.error('Error updating keyword:', error);
      showAlert('Error', getSafeErrorMessage(error, UPDATE_ERROR_MESSAGE), 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteKeyword = async () => {
    const id = deleteModal.keywordId;
    setSaving(true);
    try {
      await apiDelete<unknown>(
        `/keywords/${id}`,
        { allowStructured4xx: true }
      );
      setKeywords(keywords.filter((item) => item.id !== id));
    } catch (error) {
      console.error('Error deleting keyword:', error);
      showAlert('Error', getSafeErrorMessage(error, DELETE_ERROR_MESSAGE), 'error');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (keyword: Keyword) => {
    setEditingId(keyword.id);
    setEditText(keyword.keyword);
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <KeywordInputSection
        isBulkMode={isBulkMode}
        setIsBulkMode={setIsBulkMode}
        newKeyword={newKeyword}
        setNewKeyword={setNewKeyword}
        bulkKeywords={bulkKeywords}
        setBulkKeywords={setBulkKeywords}
        saving={saving}
        onAddKeyword={addKeyword}
        onAddBulkKeywords={addBulkKeywords}
      />

      <KeywordList
        keywords={keywords}
        editingId={editingId}
        editText={editText}
        setEditText={setEditText}
        onStartEdit={startEdit}
        onUpdateKeyword={updateKeyword}
        onCancelEdit={() => { setEditingId(null); setEditText(''); }}
        onDeleteKeyword={(id) => setDeleteModal({
          isOpen: true,
          keywordId: id
        })}
      />

      <ConfirmModal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({
          isOpen: false,
          keywordId: ''
        })}
        onConfirm={confirmDeleteKeyword}
        title="Delete Keyword"
        message="Are you sure you want to delete this keyword?"
        confirmText="Delete"
        confirmVariant="danger"
      />

      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={closeAlert}
        title={alertModal.title}
        message={alertModal.message}
        variant={alertModal.variant}
      />
    </div>
  );
};
