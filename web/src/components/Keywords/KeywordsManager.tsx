import { useState } from 'react';
import {
  apiDelete, apiPost, apiPut
} from '../../api/client';
import { ApiRequestError } from '../../infrastructure';
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

interface BulkFailure {
  keyword: string;
  message: string;
}

type BulkKeywordResult =
  | {
    outcome: 'success';
    data: Keyword;
  }
  | {
    outcome: 'failure';
    failure: BulkFailure;
  };

const CREATE_ERROR_MESSAGE = 'Failed to add keyword';
const UPDATE_ERROR_MESSAGE = 'Failed to update keyword';
const DELETE_ERROR_MESSAGE = 'Failed to delete keyword';

class InvalidKeywordResponseError extends TypeError {
  constructor() {
    super('Keyword API returned a malformed success payload');
    this.name = 'InvalidKeywordResponseError';
  }
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
    return keywords.some((item) => item.keyword.toLowerCase() === normalized);
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

    const duplicates = keywordList.filter((keyword) => isDuplicate(keyword));
    const newKeywordsToAdd = keywordList.filter((keyword) => !isDuplicate(keyword));

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

    const normalized = trimmed.toLowerCase();
    const isDuplicateEdit = keywords.some(
      (item) => item.id !== id && item.keyword.toLowerCase() === normalized
    );

    if (isDuplicateEdit) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isKeywordStatus(value: unknown): value is Keyword['status'] {
  return value === undefined || value === 'active' || value === 'inactive' || value === 'paused';
}

function isKeywordResponse(value: unknown): value is Keyword {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.keyword === 'string' &&
    typeof value.created_at === 'string' &&
    isKeywordStatus(value.status)
  );
}

function parseKeywordResponse(value: unknown): Keyword {
  if (!isKeywordResponse(value)) {
    throw new InvalidKeywordResponseError();
  }

  return value;
}

function getSafeErrorMessage(error: unknown, fallback: string): string {
  if (
    error instanceof ApiRequestError &&
    error.statusCode !== undefined &&
    error.statusCode >= 400 &&
    error.statusCode < 500 &&
    typeof error.responseMessage === 'string' &&
    error.responseMessage.length > 0
  ) {
    return error.responseMessage;
  }
  return fallback;
}

function parseBulkKeywords(input: string): string[] {
  const seen = new Set<string>();
  return input
    .split('\n')
    .map((keyword) => keyword.trim())
    .filter((keyword) => {
      if (keyword.length === 0) return false;
      const normalized = keyword.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

async function processBulkKeyword(keyword: string): Promise<BulkKeywordResult> {
  try {
    const response = await apiPost<unknown>(
      '/keywords',
      { keyword },
      { allowStructured4xx: true }
    );
    return {
      outcome: 'success',
      data: parseKeywordResponse(response),
    };
  } catch (error) {
    console.error(`Error adding bulk keyword "${keyword}":`, error);
    return {
      outcome: 'failure',
      failure: {
        keyword,
        message: getSafeErrorMessage(error, CREATE_ERROR_MESSAGE),
      },
    };
  }
}

function collectBulkResults(results: BulkKeywordResult[]): {
  addedKeywords: Keyword[];
  failures: BulkFailure[];
} {
  const addedKeywords: Keyword[] = [];
  const failures: BulkFailure[] = [];

  results.forEach((result) => {
    if (result.outcome === 'success') {
      addedKeywords.push(result.data);
    } else {
      failures.push(result.failure);
    }
  });

  return {
    addedKeywords,
    failures,
  };
}

function getBulkAlert(
  addedCount: number,
  failureCount: number
): Pick<AlertState, 'title' | 'variant'> {
  if (failureCount === 0) {
    return {
      title: 'Success',
      variant: 'success',
    };
  }
  if (addedCount > 0) {
    return {
      title: 'Partial Success',
      variant: 'info',
    };
  }
  return {
    title: 'Error',
    variant: 'error',
  };
}

function buildBulkMessage(
  addedCount: number,
  duplicateCount: number,
  failures: BulkFailure[]
): string {
  const messages: string[] = [];

  if (addedCount > 0) {
    messages.push(`Added ${addedCount} ${addedCount === 1 ? 'keyword' : 'keywords'}`);
  }
  if (duplicateCount > 0) {
    messages.push(`Skipped ${duplicateCount} ${duplicateCount === 1 ? 'duplicate' : 'duplicates'}`);
  }
  if (failures.length > 0) {
    const details = failures
      .map(({
        keyword,
        message,
      }) => `${keyword} (${message})`)
      .join(', ');
    messages.push(`Failed: ${details}`);
  }

  return messages.join('. ');
}
