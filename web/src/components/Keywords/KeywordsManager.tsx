import { useState } from 'react';
import {
  API_BASE_URL, authenticatedFetch 
} from '../../infrastructure';
import type { Keyword } from '../../types';
import {
  ConfirmModal, AlertModal 
} from '../ui/Modal';
import {
  KeywordInputSection,
  KeywordList,
} from './KeywordsManagerComponents';

interface KeywordsManagerProps {
  keywords: Keyword[];
  setKeywords: (keywords: Keyword[]) => void;
}

interface AlertState {
  isOpen: boolean;
  title: string;
  message: string;
  variant: 'success' | 'error' | 'info';
}

function isKeyword(value: unknown): value is Keyword {
  return value !== null && typeof value === 'object';
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
  const [alertModal, setAlertModal] = useState<AlertState>({
    isOpen: false,
    title: '',
    message: '',
    variant: 'info',
  });

  const isDuplicate = (keyword: string): boolean => {
    const normalized = keyword.trim().toLowerCase();
    return keywords.some((k) => k.keyword.toLowerCase() === normalized);
  };

  const showAlert = (title: string, message: string, variant: AlertState['variant']) => {
    setAlertModal({
      isOpen: true,
      title,
      message,
      variant 
    });
  };

  const addKeyword = async () => {
    const trimmed = newKeyword.trim();
    if (!trimmed) return;

    if (isDuplicate(trimmed)) {
      showAlert('Duplicate Keyword', `"${trimmed}" already exists`, 'error');
      return;
    }

    setSaving(true);
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/keywords`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: trimmed }),
      });

      const json: unknown = await response.json();
      const data: Keyword | null = isKeyword(json) ? json : null;
      if (data) {
        setKeywords([data, ...keywords]);
      }
      setNewKeyword('');
    } catch (err) {
      console.error('Error adding keyword:', err);
      showAlert('Error', 'Failed to add keyword', 'error');
    } finally {
      setSaving(false);
    }
  };

  const addBulkKeywords = async () => {
    if (!bulkKeywords.trim()) return;

    const keywordList = parseBulkKeywords(bulkKeywords);
    if (keywordList.length === 0) return;

    const duplicates = keywordList.filter((k) => isDuplicate(k));
    const newKeywordsToAdd = keywordList.filter((k) => !isDuplicate(k));

    if (newKeywordsToAdd.length === 0) {
      showAlert('All Duplicates', `All keywords already exist: ${duplicates.join(', ')}`, 'error');
      return;
    }

    setSaving(true);
    const addedKeywords: Keyword[] = [];
    const errors: string[] = [];

    try {
      for (const keyword of newKeywordsToAdd) {
        const result = await processBulkKeyword(keyword);
        if (result) {
          addedKeywords.push(result);
        } else {
          errors.push(keyword);
        }
      }

      setKeywords([...addedKeywords, ...keywords]);
      setBulkKeywords('');

      const messages: string[] = [];
      if (addedKeywords.length > 0) messages.push(`Added ${addedKeywords.length} keywords`);
      if (duplicates.length > 0) messages.push(`Skipped ${duplicates.length} duplicates`);
      if (errors.length > 0) messages.push(`Failed: ${errors.join(', ')}`);

      showAlert(
        errors.length > 0 ? 'Partial Success' : 'Success',
        messages.join('. '),
        errors.length > 0 ? 'info' : 'success'
      );
    } catch (err) {
      console.error('Error adding bulk keywords:', err);
      showAlert('Error', 'Failed to add keywords', 'error');
    } finally {
      setSaving(false);
    }
  };

  const updateKeyword = async (id: string) => {
    const trimmed = editText.trim();
    if (!trimmed) return;

    const normalized = trimmed.toLowerCase();
    const isDuplicateEdit = keywords.some(
      (k) => k.id !== id && k.keyword.toLowerCase() === normalized
    );

    if (isDuplicateEdit) {
      showAlert('Duplicate Keyword', `"${trimmed}" already exists`, 'error');
      return;
    }

    setSaving(true);
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/keywords/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: trimmed }),
      });

      const json: unknown = await response.json();
      const data: Keyword | null = isKeyword(json) ? json : null;
      if (data) {
        setKeywords(keywords.map((k) => (k.id === id ? data : k)));
      }
      setEditingId(null);
      setEditText('');
    } catch (err) {
      console.error('Error updating keyword:', err);
      showAlert('Error', 'Failed to update keyword', 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteKeyword = async () => {
    const id = deleteModal.keywordId;
    setSaving(true);
    try {
      await authenticatedFetch(`${API_BASE_URL}/keywords/${id}`, { method: 'DELETE' });
      setKeywords(keywords.filter((k) => k.id !== id));
    } catch (err) {
      console.error('Error deleting keyword:', err);
      showAlert('Error', 'Failed to delete keyword', 'error');
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
        onClose={() => setAlertModal({
          ...alertModal,
          isOpen: false 
        })}
        title={alertModal.title}
        message={alertModal.message}
        variant={alertModal.variant}
      />
    </div>
  );
};

function parseBulkKeywords(input: string): string[] {
  const seen = new Set<string>();
  return input
    .split('\n')
    .map((k) => k.trim())
    .filter((k) => {
      if (k.length === 0) return false;
      const lower = k.toLowerCase();
      if (seen.has(lower)) return false;
      seen.add(lower);
      return true;
    });
}

function isKeywordResponse(value: unknown): value is Keyword {
  return (
    value !== null &&
    typeof value === 'object' &&
    'id' in value &&
    'keyword' in value
  );
}

async function processBulkKeyword(keyword: string): Promise<Keyword | null> {
  try {
    const response = await authenticatedFetch(`${API_BASE_URL}/keywords`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword }),
    });

    if (response.ok) {
      const json: unknown = await response.json();
      if (isKeywordResponse(json)) {
        return json;
      }
    }
    return null;
  } catch {
    return null;
  }
}
