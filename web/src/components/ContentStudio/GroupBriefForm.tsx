import {
  useMemo, useState
} from 'react';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';
import type {
  GroupBriefIdea, GroupBriefMode, Keyword
} from '../../types';
import { Spinner } from '../ui/Spinner';
import { GroupBriefPromptEditor } from './GroupBriefPromptEditor';
import {
  GROUP_BRIEF_DEFAULT_TEMPLATES,
  GROUP_BRIEF_LANGUAGES,
  GROUP_BRIEF_MAX_COPY_LENGTH,
  GROUP_BRIEF_MAX_KEYWORDS,
  GROUP_BRIEF_MAX_URL_LENGTH,
  GROUP_BRIEF_MODE_OPTIONS,
  createGroupBriefIdeaId,
  validateGroupBriefDraft,
  type GroupBriefValidationField,
  type GroupBriefValidationIssue,
} from './GroupBriefForm-source';

interface GroupBriefFormProps {
  readonly keywords: Keyword[];
  readonly generating: boolean;
  readonly onGenerate: (idea: GroupBriefIdea) => Promise<boolean>;
}

interface KeywordSelectionProps {
  readonly keywords: Keyword[];
  readonly selectedIds: ReadonlySet<string>;
  readonly selectedCount: number;
  readonly generating: boolean;
  readonly onToggle: (keywordId: string) => void;
  readonly onSelectAll: () => void;
  readonly issue?: string;
}

function KeywordSelection({
  keywords,
  selectedIds,
  selectedCount,
  generating,
  onToggle,
  onSelectAll,
  issue,
}: KeywordSelectionProps) {
  if (keywords.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500">
        This group has no active keywords. Add or activate group members before generating a brief.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-gray-900">Active keywords</p>
          <p className="text-xs text-gray-500">
            {selectedCount} of {keywords.length} selected (maximum {GROUP_BRIEF_MAX_KEYWORDS})
          </p>
        </div>
        <button
          type="button"
          onClick={onSelectAll}
          disabled={generating}
          className="text-sm font-medium text-gray-700 hover:text-gray-900 disabled:text-gray-400"
        >
          {keywords.length > GROUP_BRIEF_MAX_KEYWORDS
            ? `Select first ${GROUP_BRIEF_MAX_KEYWORDS}`
            : 'Select all active'}
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
        {keywords.map((keyword) => {
          const checked = selectedIds.has(keyword.id);
          const selectionFull = selectedCount >= GROUP_BRIEF_MAX_KEYWORDS;
          return (
            <label
              key={keyword.id}
              className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gray-50"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(keyword.id)}
                disabled={generating || (selectionFull && !checked)}
                className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
              />
              <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
                {keyword.keyword}
              </span>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                Active
              </span>
            </label>
          );
        })}
      </div>
      {issue && <p role="alert" className="text-sm text-red-600">{issue}</p>}
    </div>
  );
}

function validationMessage(
  issues: GroupBriefValidationIssue[], field: GroupBriefValidationField
): string | undefined {
  return issues.find((issue) => issue.field === field)?.message;
}

function activeMembersForGroup(keywords: Keyword[], groupId: string): Keyword[] {
  return keywords.filter(
    (keyword) => (
      keyword.status === 'active'
      && keyword.group_ids?.includes(groupId) === true
    )
  );
}

export function GroupBriefForm({
  keywords,
  generating,
  onGenerate,
}: GroupBriefFormProps) {
  const {
    groups, loading, error
  } = useKeywordGroups();
  const [groupId, setGroupId] = useState('');
  const [selectedKeywordIds, setSelectedKeywordIds] = useState<string[]>([]);
  const [mode, setMode] = useState<GroupBriefMode>('create_new_landing_page');
  const [landingUrl, setLandingUrl] = useState('');
  const [currentCopy, setCurrentCopy] = useState('');
  const [promptTemplate, setPromptTemplate] = useState(
    GROUP_BRIEF_DEFAULT_TEMPLATES.create_new_landing_page
  );
  const [outputLanguage, setOutputLanguage] = useState('English');
  const [validationIssues, setValidationIssues] = useState<GroupBriefValidationIssue[]>([]);
  const [clientIdeaId, setClientIdeaId] = useState(createGroupBriefIdeaId);

  const selectedGroup = groups.find((group) => group.id === groupId);
  const activeMembers = useMemo(
    () => activeMembersForGroup(keywords, groupId),
    [groupId, keywords]
  );
  const selectedIdSet = useMemo(
    () => new Set(selectedKeywordIds),
    [selectedKeywordIds]
  );
  const selectedKeywords = activeMembers.filter((keyword) => selectedIdSet.has(keyword.id));

  const handleGroupChange = (nextGroupId: string) => {
    const members = activeMembersForGroup(keywords, nextGroupId);
    setGroupId(nextGroupId);
    setSelectedKeywordIds(
      members.slice(0, GROUP_BRIEF_MAX_KEYWORDS).map((keyword) => keyword.id)
    );
    setValidationIssues([]);
  };

  const handleModeChange = (nextMode: GroupBriefMode) => {
    setMode(nextMode);
    setLandingUrl((currentUrl) => (
      nextMode === 'improve_current_url' ? currentUrl : ''
    ));
    setCurrentCopy((copy) => (
      nextMode === 'rewrite_pasted_copy' ? copy : ''
    ));
    setPromptTemplate(GROUP_BRIEF_DEFAULT_TEMPLATES[nextMode]);
    setValidationIssues([]);
  };

  const toggleKeyword = (keywordId: string) => {
    const nextIds = new Set(selectedKeywordIds);
    if (nextIds.has(keywordId)) {
      nextIds.delete(keywordId);
    } else if (nextIds.size < GROUP_BRIEF_MAX_KEYWORDS) {
      nextIds.add(keywordId);
    }
    setSelectedKeywordIds([...nextIds]);
  };

  const selectAllActive = () => {
    setSelectedKeywordIds(
      activeMembers.slice(0, GROUP_BRIEF_MAX_KEYWORDS).map((keyword) => keyword.id)
    );
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const effectiveKeywordIds = selectedKeywords.map((keyword) => keyword.id);
    const issues = validateGroupBriefDraft({
      groupId,
      selectedKeywordIds: effectiveKeywordIds,
      mode,
      landingUrl,
      currentCopy,
      promptTemplate,
    });
    if (selectedGroup === undefined) {
      setValidationIssues([
        ...issues.filter((issue) => issue.field !== 'group_id'),
        {
          field: 'group_id',
          message: 'Select a keyword group.',
        },
      ]);
      return;
    }
    if (issues.length > 0) {
      setValidationIssues(issues);
      return;
    }

    setValidationIssues([]);
    const keywordNoun = selectedKeywords.length === 1 ? 'keyword' : 'keywords';
    const idea = {
      id: clientIdeaId,
      type: 'group_brief',
      priority: 'medium',
      title: `Group Brief: ${selectedGroup.name}`,
      description: `Generate a complete landing page from ${selectedKeywords.length} selected active ${keywordNoun}.`,
      keyword: selectedGroup.name,
      source: 'group_brief',
      actionable: true,
      content_angle: mode,
      group_id: selectedGroup.id,
      group_name: selectedGroup.name,
      keyword_ids: effectiveKeywordIds,
      keywords: selectedKeywords.map((keyword) => keyword.keyword),
      landing_url: mode === 'improve_current_url' ? landingUrl.trim() : '',
      current_copy: mode === 'rewrite_pasted_copy' ? currentCopy : '',
      prompt_template: promptTemplate,
      output_language: outputLanguage,
      competitor_urls: [],
    } satisfies GroupBriefIdea;

    const generated = await onGenerate(idea);
    if (generated) {
      setClientIdeaId(createGroupBriefIdeaId());
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-12 text-sm text-gray-500">
        <Spinner size="md" /> Loading keyword groups...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Keyword groups could not be loaded. {error}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
        <p className="font-medium text-gray-900">No keyword groups yet</p>
        <p className="mt-1 text-sm text-gray-500">
          Create a keyword group and add active keywords before building a group brief.
        </p>
      </div>
    );
  }

  const groupIssue = validationMessage(validationIssues, 'group_id');
  const keywordIssue = validationMessage(validationIssues, 'keyword_ids');
  const urlIssue = validationMessage(validationIssues, 'landing_url');
  const copyIssue = validationMessage(validationIssues, 'current_copy');
  const templateIssue = validationMessage(validationIssues, 'prompt_template');

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-5">
        <div>
          <label htmlFor="group-brief-group" className="block text-sm font-medium text-gray-900">
            Keyword group
          </label>
          <select
            id="group-brief-group"
            value={groupId}
            onChange={(event) => handleGroupChange(event.target.value)}
            disabled={generating}
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          >
            <option value="">Select a group</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name} ({group.keyword_count})
              </option>
            ))}
          </select>
          {groupIssue && <p role="alert" className="mt-1 text-sm text-red-600">{groupIssue}</p>}
        </div>

        {groupId !== '' && (
          <KeywordSelection
            keywords={activeMembers}
            selectedIds={selectedIdSet}
            selectedCount={selectedKeywords.length}
            generating={generating}
            onToggle={toggleKeyword}
            onSelectAll={selectAllActive}
            issue={keywordIssue}
          />
        )}
      </div>

      <fieldset className="rounded-xl border border-gray-200 bg-white p-5">
        <legend className="px-1 text-sm font-semibold text-gray-900">Generation mode</legend>
        <div className="mt-2 grid gap-3 lg:grid-cols-3">
          {GROUP_BRIEF_MODE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`cursor-pointer rounded-lg border p-3 ${
                mode === option.value ? 'border-gray-900 bg-gray-50' : 'border-gray-200'
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
                <input
                  type="radio"
                  name="group-brief-mode"
                  value={option.value}
                  checked={mode === option.value}
                  onChange={() => handleModeChange(option.value)}
                  disabled={generating}
                />
                {option.label}
              </span>
              <span className="mt-1 block text-xs text-gray-500">{option.description}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {mode === 'improve_current_url' && (
        <div>
          <label htmlFor="group-brief-url" className="block text-sm font-medium text-gray-900">
            Current landing URL
          </label>
          <input
            id="group-brief-url"
            type="url"
            value={landingUrl}
            onChange={(event) => setLandingUrl(event.target.value)}
            maxLength={GROUP_BRIEF_MAX_URL_LENGTH}
            placeholder="https://example.com/page"
            disabled={generating}
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
          {urlIssue && <p role="alert" className="mt-1 text-sm text-red-600">{urlIssue}</p>}
        </div>
      )}

      {mode === 'rewrite_pasted_copy' && (
        <div>
          <label htmlFor="group-brief-copy" className="block text-sm font-medium text-gray-900">
            Current copy
          </label>
          <textarea
            id="group-brief-copy"
            value={currentCopy}
            onChange={(event) => setCurrentCopy(event.target.value)}
            maxLength={GROUP_BRIEF_MAX_COPY_LENGTH}
            rows={8}
            disabled={generating}
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
          <div className="mt-1 flex justify-between text-xs text-gray-500">
            <span>{copyIssue ?? 'Paste the source copy that should be rewritten.'}</span>
            <span>{GROUP_BRIEF_MAX_COPY_LENGTH - currentCopy.length} characters remaining</span>
          </div>
        </div>
      )}

      <GroupBriefPromptEditor
        mode={mode}
        promptTemplate={promptTemplate}
        disabled={generating}
        issue={templateIssue}
        onChange={setPromptTemplate}
      />

      <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <label htmlFor="group-brief-language" className="block text-sm font-medium text-gray-900">
            Output language
          </label>
          <select
            id="group-brief-language"
            value={outputLanguage}
            onChange={(event) => setOutputLanguage(event.target.value)}
            disabled={generating}
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          >
            {GROUP_BRIEF_LANGUAGES.map((language) => (
              <option key={language} value={language}>{language}</option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={generating}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {generating && <Spinner size="sm" />}
          {generating ? 'Starting generation...' : 'Generate group brief'}
        </button>
      </div>
    </form>
  );
}
