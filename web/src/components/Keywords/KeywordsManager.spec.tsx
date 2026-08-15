import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  render, screen, waitFor, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  apiDelete, apiPost, apiPut
} from '../../api/client';
import { KeywordsManager } from './KeywordsManager';
import {
  BULK_CONFLICT_MESSAGE,
  bulkCreatedKeywordFixture,
  CREATE_CONFLICT_MESSAGE,
  CREATE_FALLBACK_MESSAGE,
  createdKeywordFixture,
  createApiRequestError,
  createKeywordsManagerProps,
  createTransportError,
  DELETE_FALLBACK_MESSAGE,
  DELETE_NOT_FOUND_MESSAGE,
  DELETE_SERVER_MESSAGE,
  existingKeywordFixture,
  extendedCreatedKeywordFixture,
  FAILED_BULK_KEYWORD,
  malformedKeywordFixture,
  UPDATE_CONFLICT_MESSAGE,
  updatedKeywordFixture,
} from './KeywordsManager-fixtures';

vi.mock('../../api/client', () => ({
  apiDelete: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
}));

const mockApiDelete = vi.mocked(apiDelete);
const mockApiPost = vi.mocked(apiPost);
const mockApiPut = vi.mocked(apiPut);

async function submitCreate(keyword = createdKeywordFixture.keyword) {
  const user = userEvent.setup();
  const input = screen.getByPlaceholderText('Enter new keyword...');
  await user.type(input, keyword);
  await user.click(screen.getByRole('button', { name: 'Add' }));
  return input;
}

function getKeywordActionButtons() {
  const keywordRow = screen.getByText(existingKeywordFixture.keyword).parentElement;
  return within(keywordRow ?? document.body).getAllByRole('button');
}

async function submitUpdate() {
  const user = userEvent.setup();
  const [editButton] = getKeywordActionButtons();
  await user.click(editButton);

  const input = screen.getByDisplayValue(existingKeywordFixture.keyword);
  await user.clear(input);
  await user.type(input, updatedKeywordFixture.keyword);
  await user.click(screen.getByRole('button', { name: 'Save' }));
  return input;
}

async function submitDelete() {
  const user = userEvent.setup();
  const [, deleteButton] = getKeywordActionButtons();
  await user.click(deleteButton);
  await user.click(screen.getByRole('button', { name: 'Delete' }));
}

async function submitBulk() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Bulk Entry' }));
  const input = screen.getByPlaceholderText('Enter multiple keywords (one per line)');
  await user.type(
    input,
    `${bulkCreatedKeywordFixture.keyword}\n${FAILED_BULK_KEYWORD}`
  );
  await user.click(screen.getByRole('button', { name: 'Add All' }));
  return input;
}

describe('KeywordsManager', () => {
  beforeEach(() => {
    mockApiDelete.mockReset();
    mockApiPost.mockReset();
    mockApiPut.mockReset();
    vi.spyOn(console, 'error').mockImplementation(vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('rendering', () => {
    it('renders manager heading when keyword list is empty', () => {
      const props = createKeywordsManagerProps([]);
      render(<KeywordsManager {...props} />);

      expect(screen.getByRole('heading', { name: 'Manage Keywords' })).toBeInTheDocument();
    });

    it('renders keyword text when keywords exist', () => {
      const props = createKeywordsManagerProps();
      render(<KeywordsManager {...props} />);

      expect(screen.getByText(existingKeywordFixture.keyword)).toBeInTheDocument();
    });

    it('shows empty-state message when keyword list is empty', () => {
      const props = createKeywordsManagerProps([]);
      render(<KeywordsManager {...props} />);

      expect(screen.getByText(/No keywords yet/u)).toBeInTheDocument();
    });

    it('renders single-entry input by default', () => {
      const props = createKeywordsManagerProps([]);
      render(<KeywordsManager {...props} />);

      expect(screen.getByPlaceholderText('Enter new keyword...')).toBeInTheDocument();
    });
  });

  describe('create mutation', () => {
    it('preserves entered text when create returns a conflict', async () => {
      const props = createKeywordsManagerProps();
      mockApiPost.mockRejectedValue(createApiRequestError(CREATE_CONFLICT_MESSAGE));
      render(<KeywordsManager {...props} />);

      const input = await submitCreate();
      await screen.findByText(CREATE_CONFLICT_MESSAGE);

      expect(input).toHaveValue(createdKeywordFixture.keyword);
    });

    it('shows exact backend message when create returns a conflict', async () => {
      const props = createKeywordsManagerProps();
      mockApiPost.mockRejectedValue(createApiRequestError(CREATE_CONFLICT_MESSAGE));
      render(<KeywordsManager {...props} />);

      await submitCreate();

      expect(await screen.findByText(CREATE_CONFLICT_MESSAGE)).toBeInTheDocument();
    });

    it('does not update parent state when create returns a conflict', async () => {
      const props = createKeywordsManagerProps();
      mockApiPost.mockRejectedValue(createApiRequestError(CREATE_CONFLICT_MESSAGE));
      render(<KeywordsManager {...props} />);

      await submitCreate();
      await screen.findByText(CREATE_CONFLICT_MESSAGE);

      expect(props.setKeywords).not.toHaveBeenCalled();
    });

    it('clears entered text when create returns a valid keyword', async () => {
      const props = createKeywordsManagerProps();
      mockApiPost.mockResolvedValue(createdKeywordFixture);
      render(<KeywordsManager {...props} />);

      const input = await submitCreate();

      await waitFor(() => expect(input).toHaveValue(''));
    });

    it('prepends returned keyword when create succeeds', async () => {
      const props = createKeywordsManagerProps();
      mockApiPost.mockResolvedValue(createdKeywordFixture);
      render(<KeywordsManager {...props} />);

      await submitCreate();

      await waitFor(() => expect(props.setKeywords).toHaveBeenCalledWith([
        createdKeywordFixture,
        ...props.keywords,
      ]));
      expect(mockApiPost).toHaveBeenCalledWith(
        '/keywords',
        { keyword: createdKeywordFixture.keyword },
        { allowStructured4xx: true }
      );
    });

    it('preserves extended response fields in parent state when create succeeds', async () => {
      const props = createKeywordsManagerProps();
      mockApiPost.mockResolvedValue(extendedCreatedKeywordFixture);
      render(<KeywordsManager {...props} />);

      await submitCreate();

      await waitFor(() => expect(props.setKeywords.mock.calls[0]?.[0]).toStrictEqual([
        extendedCreatedKeywordFixture,
        ...props.keywords,
      ]));
    });

    it('preserves create state when success payload is malformed', async () => {
      const props = createKeywordsManagerProps();
      mockApiPost.mockResolvedValue(malformedKeywordFixture);
      render(<KeywordsManager {...props} />);

      const input = await submitCreate();
      await screen.findByText(CREATE_FALLBACK_MESSAGE);

      expect(input).toHaveValue(createdKeywordFixture.keyword);
      expect(props.setKeywords).not.toHaveBeenCalled();
    });

    it('shows safe fallback when create transport fails', async () => {
      const props = createKeywordsManagerProps();
      mockApiPost.mockRejectedValue(createTransportError());
      render(<KeywordsManager {...props} />);

      await submitCreate();

      expect(await screen.findByText(CREATE_FALLBACK_MESSAGE)).toBeInTheDocument();
    });
  });

  describe('update mutation', () => {
    it('preserves attempted text in editor when update returns a conflict', async () => {
      const props = createKeywordsManagerProps();
      mockApiPut.mockRejectedValue(createApiRequestError(UPDATE_CONFLICT_MESSAGE));
      render(<KeywordsManager {...props} />);

      await submitUpdate();
      await screen.findByText(UPDATE_CONFLICT_MESSAGE);

      expect(screen.getByDisplayValue(updatedKeywordFixture.keyword)).toBeInTheDocument();
    });

    it('shows exact backend message when update returns a conflict', async () => {
      const props = createKeywordsManagerProps();
      mockApiPut.mockRejectedValue(createApiRequestError(UPDATE_CONFLICT_MESSAGE));
      render(<KeywordsManager {...props} />);

      await submitUpdate();

      expect(await screen.findByText(UPDATE_CONFLICT_MESSAGE)).toBeInTheDocument();
    });

    it('does not update parent state when update returns a conflict', async () => {
      const props = createKeywordsManagerProps();
      mockApiPut.mockRejectedValue(createApiRequestError(UPDATE_CONFLICT_MESSAGE));
      render(<KeywordsManager {...props} />);

      await submitUpdate();
      await screen.findByText(UPDATE_CONFLICT_MESSAGE);

      expect(props.setKeywords).not.toHaveBeenCalled();
    });

    it('closes editor when update returns a valid keyword', async () => {
      const props = createKeywordsManagerProps();
      mockApiPut.mockResolvedValue(updatedKeywordFixture);
      render(<KeywordsManager {...props} />);

      await submitUpdate();

      await waitFor(() => {
        expect(screen.queryByDisplayValue(updatedKeywordFixture.keyword)).not.toBeInTheDocument();
      });
    });

    it('replaces keyword when update returns a valid keyword', async () => {
      const props = createKeywordsManagerProps();
      mockApiPut.mockResolvedValue(updatedKeywordFixture);
      render(<KeywordsManager {...props} />);

      await submitUpdate();

      await waitFor(() => expect(props.setKeywords).toHaveBeenCalledWith([
        updatedKeywordFixture,
      ]));
      expect(mockApiPut).toHaveBeenCalledWith(
        '/keywords/keyword-1',
        { keyword: updatedKeywordFixture.keyword },
        { allowStructured4xx: true }
      );
    });
  });

  describe('delete mutation', () => {
    it('preserves keyword when delete targets a missing row', async () => {
      const props = createKeywordsManagerProps();
      mockApiDelete.mockRejectedValue(createApiRequestError(DELETE_NOT_FOUND_MESSAGE, 404));
      render(<KeywordsManager {...props} />);

      await submitDelete();
      await screen.findByText(DELETE_NOT_FOUND_MESSAGE);

      expect(props.setKeywords).not.toHaveBeenCalled();
    });

    it('shows exact backend message when delete targets a missing row', async () => {
      const props = createKeywordsManagerProps();
      mockApiDelete.mockRejectedValue(createApiRequestError(DELETE_NOT_FOUND_MESSAGE, 404));
      render(<KeywordsManager {...props} />);

      await submitDelete();

      expect(await screen.findByText(DELETE_NOT_FOUND_MESSAGE)).toBeInTheDocument();
    });

    it('shows safe fallback when delete transport fails', async () => {
      const props = createKeywordsManagerProps();
      mockApiDelete.mockRejectedValue(createTransportError());
      render(<KeywordsManager {...props} />);

      await submitDelete();

      expect(await screen.findByText(DELETE_FALLBACK_MESSAGE)).toBeInTheDocument();
    });

    it('shows safe fallback when delete returns a server error', async () => {
      const props = createKeywordsManagerProps();
      mockApiDelete.mockRejectedValue(createApiRequestError(DELETE_SERVER_MESSAGE, 500));
      render(<KeywordsManager {...props} />);

      await submitDelete();

      expect(await screen.findByText(DELETE_FALLBACK_MESSAGE)).toBeInTheDocument();
    });

    it('removes keyword when delete succeeds', async () => {
      const props = createKeywordsManagerProps();
      mockApiDelete.mockResolvedValue({ message: 'Keyword deleted successfully' });
      render(<KeywordsManager {...props} />);

      await submitDelete();

      await waitFor(() => expect(props.setKeywords).toHaveBeenCalledWith([]));
      expect(mockApiDelete).toHaveBeenCalledWith(
        '/keywords/keyword-1',
        { allowStructured4xx: true }
      );
    });
  });

  describe('bulk create mutation', () => {
    it('retains failed bulk entry when another entry succeeds', async () => {
      const props = createKeywordsManagerProps();
      mockApiPost
        .mockResolvedValueOnce(bulkCreatedKeywordFixture)
        .mockRejectedValueOnce(createApiRequestError(BULK_CONFLICT_MESSAGE));
      render(<KeywordsManager {...props} />);

      const input = await submitBulk();

      await waitFor(() => expect(input).toHaveValue(FAILED_BULK_KEYWORD));
    });

    it('preserves successful bulk entry when another entry fails', async () => {
      const props = createKeywordsManagerProps();
      mockApiPost
        .mockResolvedValueOnce(bulkCreatedKeywordFixture)
        .mockRejectedValueOnce(createApiRequestError(BULK_CONFLICT_MESSAGE));
      render(<KeywordsManager {...props} />);

      await submitBulk();

      await waitFor(() => expect(props.setKeywords.mock.calls[0]?.[0]).toStrictEqual([
        bulkCreatedKeywordFixture,
        ...props.keywords,
      ]));
    });

    it('reports backend failure when bulk create partially succeeds', async () => {
      const props = createKeywordsManagerProps();
      mockApiPost
        .mockResolvedValueOnce(bulkCreatedKeywordFixture)
        .mockRejectedValueOnce(createApiRequestError(BULK_CONFLICT_MESSAGE));
      render(<KeywordsManager {...props} />);

      await submitBulk();

      expect(await screen.findByText(
        `Added 1 keyword. Failed: ${FAILED_BULK_KEYWORD} (${BULK_CONFLICT_MESSAGE})`
      )).toBeInTheDocument();
    });

    it('includes structured 4xx opt-in when each bulk keyword is submitted', async () => {
      const props = createKeywordsManagerProps();
      mockApiPost.mockResolvedValue(bulkCreatedKeywordFixture);
      render(<KeywordsManager {...props} />);

      await submitBulk();

      await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(2));
      expect(mockApiPost).toHaveBeenNthCalledWith(
        1,
        '/keywords',
        { keyword: bulkCreatedKeywordFixture.keyword },
        { allowStructured4xx: true }
      );
      expect(mockApiPost).toHaveBeenNthCalledWith(
        2,
        '/keywords',
        { keyword: FAILED_BULK_KEYWORD },
        { allowStructured4xx: true }
      );
    });

    it('starts second bulk create after first request settles', async () => {
      const props = createKeywordsManagerProps();
      const requestSequence = {
        firstSettled: false,
        firstSettledBeforeSecondStarted: false,
      };
      mockApiPost
        .mockImplementationOnce(async () => {
          await Promise.resolve();
          requestSequence.firstSettled = true;
          return bulkCreatedKeywordFixture;
        })
        .mockImplementationOnce(() => {
          requestSequence.firstSettledBeforeSecondStarted = requestSequence.firstSettled;
          return Promise.reject(createApiRequestError(BULK_CONFLICT_MESSAGE));
        });
      render(<KeywordsManager {...props} />);

      await submitBulk();

      await waitFor(() => {
        expect(requestSequence.firstSettledBeforeSecondStarted).toBe(true);
      });
    });
  });
});
