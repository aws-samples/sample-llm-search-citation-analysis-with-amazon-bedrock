import {
  useMemo, useState
} from 'react';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';
import type {
  AnalysisScope,
  ContentBriefBatchRequest,
  ContentBriefScope,
  ContentBriefStrategy,
  GroupBriefIdea,
  GroupBriefMode,
  Keyword,
} from '../../types';
import { KeywordScopePicker } from '../ui/KeywordScopePicker';
import { Spinner } from '../ui/Spinner';
import {
  GenerationConfirmation,
  GenerationModeFields,
  issueMessage,
  ScopePreview,
  StrategyFields,
} from './GroupBriefFields';
import {
  canonicalContentBriefScope,
  contentBriefFields,
  pendingContentBriefGeneration,
  selectedActiveKeywords,
  type PendingGeneration,
} from './GroupBriefForm-logic';
import {
  GROUP_BRIEF_BATCH_LIMIT_GUIDANCE,
  GROUP_BRIEF_BATCH_MAX_KEYWORDS,
  GROUP_BRIEF_LANGUAGES,
  createGroupBriefIdeaId,
  validateGroupBriefDraft,
  type GroupBriefValidationIssue,
} from './GroupBriefForm-source';
import { GroupBriefPromptEditor } from './GroupBriefPromptEditor';
import { useGroupBriefTemplateDraft } from './useGroupBriefTemplateDraft';

interface GroupBriefFormProps {
  readonly keywords: Keyword[];
  readonly generating: boolean;
  readonly onGenerate: (idea: GroupBriefIdea) => Promise<boolean>;
  readonly onGenerateBatch: (request: ContentBriefBatchRequest) => Promise<boolean>;
}

function batchCapIssue(
  strategy: ContentBriefStrategy,
  selectedKeywordCount: number,
  issues: GroupBriefValidationIssue[]
): string | undefined {
  if (strategy === 'per_keyword' && selectedKeywordCount > GROUP_BRIEF_BATCH_MAX_KEYWORDS) {
    return GROUP_BRIEF_BATCH_LIMIT_GUIDANCE;
  }
  return issueMessage(issues, 'strategy');
}

export function GroupBriefForm({
  keywords,
  generating,
  onGenerate,
  onGenerateBatch,
}: GroupBriefFormProps) {
  const {
    groups, loading: groupsLoading, error: groupsError
  } = useKeywordGroups();
  const [scope, setScope] = useState<ContentBriefScope>({
    mode: 'keywords',
    keyword_ids: [],
  });
  const [strategy, setStrategy] = useState<ContentBriefStrategy>('combined');
  const [mode, setMode] = useState<GroupBriefMode>('create_new_landing_page');
  const [landingUrl, setLandingUrl] = useState('');
  const [currentCopy, setCurrentCopy] = useState('');
  const [outputLanguage, setOutputLanguage] = useState('English');
  const [validationIssues, setValidationIssues] = useState<GroupBriefValidationIssue[]>([]);
  const [clientIdeaId, setClientIdeaId] = useState(createGroupBriefIdeaId);
  const [pendingGeneration, setPendingGeneration] = useState<PendingGeneration | null>(null);
  const template = useGroupBriefTemplateDraft(mode);

  const activeKeywords = useMemo(
    () => keywords.filter((keyword) => keyword.status === 'active'),
    [keywords]
  );
  const selectedKeywords = useMemo(
    () => selectedActiveKeywords(scope, activeKeywords),
    [activeKeywords, scope]
  );
  const canonicalScope = useMemo(
    () => canonicalContentBriefScope(scope, groups, selectedKeywords),
    [groups, scope, selectedKeywords]
  );

  const handleModeChange = (nextMode: GroupBriefMode) => {
    setMode(nextMode);
    if (nextMode !== 'improve_current_url') setLandingUrl('');
    if (nextMode !== 'rewrite_pasted_copy') setCurrentCopy('');
    template.selectBuiltin(nextMode);
    setValidationIssues([]);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const issues = validateGroupBriefDraft({
      scope: canonicalScope,
      selectedKeywordCount: selectedKeywords.length,
      strategy,
      mode,
      landingUrl,
      currentCopy,
      promptTemplate: template.draft.prompt,
      templateId: template.selectedTemplateId,
    });
    setValidationIssues(issues);
    if (issues.length > 0) return;

    const fields = contentBriefFields(
      mode,
      landingUrl,
      currentCopy,
      template.selectedTemplateId,
      template.draft.prompt,
      outputLanguage
    );
    setPendingGeneration(pendingContentBriefGeneration(
      strategy,
      clientIdeaId,
      canonicalScope,
      fields,
      selectedKeywords.length
    ));
  };

  const confirmGeneration = async () => {
    if (pendingGeneration === null) return;
    const accepted = pendingGeneration.strategy === 'combined'
      ? await onGenerate(pendingGeneration.idea)
      : await onGenerateBatch(pendingGeneration.request);
    if (accepted) setClientIdeaId(createGroupBriefIdeaId());
    setPendingGeneration(null);
  };

  const scopeIssue = issueMessage(validationIssues, 'scope');
  const strategyIssue = batchCapIssue(strategy, selectedKeywords.length, validationIssues);
  const requestDisabled = generating || template.loading || strategyIssue !== undefined;
  const loadError = groupsError ?? template.error;

  if (groupsLoading) {
    return (
      <div className="flex items-center justify-center gap-3 py-12 text-sm text-gray-500">
        <Spinner size="md" /> Loading keyword groups...
      </div>
    );
  }

  return (
    <>
      <form onSubmit={handleSubmit} noValidate className="space-y-6" aria-label="Content Brief">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Content Brief</h2>
          <p className="mt-1 text-sm text-gray-500">
            Create one scoped brief or queue separate background briefs for each keyword.
          </p>
        </div>

        {loadError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {loadError}
          </div>
        )}

        <fieldset className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
          <legend className="px-1 text-sm font-semibold text-gray-900">Target scope</legend>
          <KeywordScopePicker
            idPrefix="group-brief-keyword-scope"
            name="group-brief-keyword-ids"
            keywords={activeKeywords}
            groups={groups}
            scope={scope}
            onChange={(nextScope: AnalysisScope) => {
              if (nextScope.mode === 'all') return;
              setScope(nextScope);
              setValidationIssues([]);
            }}
            allowedModes={['groups', 'keywords']}
            maxGroups={1}
            maxKeywords={50}
            disabled={generating}
          />
          <ScopePreview scope={canonicalScope} groups={groups} keywords={selectedKeywords} />
          {scopeIssue && <p role="alert" className="text-sm text-red-600">{scopeIssue}</p>}
        </fieldset>

        <StrategyFields
          strategy={strategy}
          selectedKeywordCount={selectedKeywords.length}
          disabled={generating}
          issue={strategyIssue}
          onChange={(nextStrategy) => {
            setStrategy(nextStrategy);
            setValidationIssues([]);
          }}
        />

        <GenerationModeFields
          mode={mode}
          landingUrl={landingUrl}
          currentCopy={currentCopy}
          disabled={generating}
          issues={validationIssues}
          onModeChange={handleModeChange}
          onLandingUrlChange={setLandingUrl}
          onCurrentCopyChange={setCurrentCopy}
        />

        <GroupBriefPromptEditor
          mode={mode}
          templates={template.templates}
          templatesLoading={template.loading}
          selectedTemplate={template.selectedTemplate}
          templateName={template.draft.name}
          templateDescription={template.draft.description}
          promptTemplate={template.draft.prompt}
          dirty={template.dirty}
          disabled={generating}
          saving={template.saving}
          issue={issueMessage(validationIssues, 'prompt_template')
            ?? issueMessage(validationIssues, 'template_id')}
          notice={template.notice ?? undefined}
          onSelect={template.select}
          onNameChange={template.setName}
          onDescriptionChange={template.setDescription}
          onPromptChange={template.setPrompt}
          onReset={template.reset}
          onSaveAsNew={template.saveAsNew}
          onUpdate={template.updateSelected}
          onDelete={template.deleteSelected}
        />

        <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="w-full sm:max-w-xs">
            <label htmlFor="group-brief-language" className="block text-sm font-medium text-gray-900">
              Output language
            </label>
            <select
              id="group-brief-language"
              name="group-brief-language"
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
            disabled={requestDisabled}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Review generation
          </button>
        </div>
      </form>

      <GenerationConfirmation
        pending={pendingGeneration}
        generating={generating}
        onClose={() => setPendingGeneration(null)}
        onConfirm={confirmGeneration}
      />
    </>
  );
}
