import {
  useEffect, useMemo, useState
} from 'react';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';
import type {
  ContentBriefBatchRequest,
  ContentBriefScope,
  ContentBriefStrategy,
  GroupBriefIdea,
  GroupBriefMode,
  Keyword,
  KeywordGroup,
} from '../../types';
import { GroupBriefFormSkeleton } from './ContentStudioSkeletons';
import { BriefKeywordFields } from './BriefKeywordFields';
import { BriefReviewFields } from './BriefReviewFields';
import { BriefStep } from './BriefStep';
import {
  describeBriefScope, emptyBriefScope
} from './briefScope';
import {
  GenerationConfirmation,
  GenerationModeFields,
  issueMessage,
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
  GROUP_BRIEF_MODE_OPTIONS,
  createGroupBriefIdeaId,
  validateGroupBriefDraft,
  type GroupBriefValidationField,
  type GroupBriefValidationIssue,
} from './GroupBriefForm-source';
import { GroupBriefPromptEditor } from './GroupBriefPromptEditor';
import { useGroupBriefTemplateDraft } from './useGroupBriefTemplateDraft';
import {
  keywordsInMarkets, scopeMarketIds
} from '../Markets/marketScope';

interface GroupBriefFormProps {
  readonly keywords: Keyword[];
  readonly generating: boolean;
  readonly onGenerate: (idea: GroupBriefIdea) => Promise<boolean>;
  readonly onGenerateBatch: (request: ContentBriefBatchRequest) => Promise<boolean>;
  /** Keywords to start with ticked, as when a content idea opens the brief. */
  readonly initialKeywordIds?: readonly string[];
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

/** Handed-in keywords open on "Specific keywords"; otherwise a keyword group, the usual unit of a brief. */
function initialBriefScope(
  groups: readonly KeywordGroup[], initialKeywordIds: readonly string[] | undefined
): ContentBriefScope {
  if (initialKeywordIds !== undefined && initialKeywordIds.length > 0) {
    return {
      mode: 'keywords',
      keyword_ids: [...initialKeywordIds],
    };
  }
  return emptyBriefScope(groups.length > 0 ? 'groups' : 'keywords');
}

/** The control to focus for the first validation issue. */
function issueFieldId(field: GroupBriefValidationField, scope: ContentBriefScope): string | null {
  // The strategy issue already disables the button beside it.
  if (field === 'strategy') return null;
  if (field === 'scope') return scope.mode === 'groups' ? 'group-brief-group' : 'group-brief-keyword-scope-search';
  if (field === 'landing_url') return 'group-brief-url';
  if (field === 'current_copy') return 'group-brief-copy';
  return 'group-brief-template';
}

function modeLabel(mode: GroupBriefMode): string {
  return GROUP_BRIEF_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode;
}

/** The Content Brief tab: holds a placeholder until the keyword groups are known, as they pick the default scope. */
export function GroupBriefForm(props: GroupBriefFormProps) {
  const {
    groups, loading, error
  } = useKeywordGroups();
  if (loading) return <GroupBriefFormSkeleton />;
  return <GroupBriefSteps {...props} groups={groups} groupsError={error} />;
}

/**
 * Three numbered steps in the order the user decides: what to write, for
 * which keywords, then a review with the paid-call estimate and the one
 * primary action, which opens the cost confirmation.
 */
function GroupBriefSteps({
  keywords,
  generating,
  onGenerate,
  onGenerateBatch,
  initialKeywordIds,
  groups,
  groupsError,
}: GroupBriefFormProps & {
  readonly groups: KeywordGroup[];
  readonly groupsError: string | null;
}) {
  const [scope, setScope] = useState<ContentBriefScope>(() => initialBriefScope(groups, initialKeywordIds));
  const [strategy, setStrategy] = useState<ContentBriefStrategy>('combined');
  const [mode, setMode] = useState<GroupBriefMode>('create_new_landing_page');
  const [landingUrl, setLandingUrl] = useState('');
  const [currentCopy, setCurrentCopy] = useState('');
  const [outputLanguage, setOutputLanguage] = useState('English');
  const [validationIssues, setValidationIssues] = useState<GroupBriefValidationIssue[]>([]);
  const [clientIdeaId, setClientIdeaId] = useState(createGroupBriefIdeaId);
  const [pendingGeneration, setPendingGeneration] = useState<PendingGeneration | null>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const template = useGroupBriefTemplateDraft(mode);

  const activeKeywords = useMemo(
    () => keywords.filter((keyword) => keyword.status === 'active'),
    [keywords]
  );
  const marketIds = useMemo(() => scopeMarketIds(scope), [scope]);
  const pickableKeywords = useMemo(
    () => keywordsInMarkets(activeKeywords, marketIds),
    [activeKeywords, marketIds]
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
    if (issues.length > 0) {
      // The problem may sit steps above the button, so take the user to it.
      setFocusTarget(issueFieldId(issues[0].field, canonicalScope));
      return;
    }

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

  // Runs after the render that shows the issue, so a field revealed by it (the prompt editor) exists.
  useEffect(() => {
    if (focusTarget === null) return;
    document.getElementById(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  const changeScope = (nextScope: ContentBriefScope) => {
    setScope(nextScope);
    setValidationIssues([]);
  };
  const summary = [
    modeLabel(mode),
    describeBriefScope(canonicalScope, groups, selectedKeywords.length),
    outputLanguage,
  ].join(' · ');

  return (
    <>
      <form onSubmit={handleSubmit} noValidate className="space-y-6" aria-label="Content Brief">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Content Brief</h2>
          <p className="mt-1 text-sm text-gray-500">
            Get a landing-page draft written from what AI engines answer for your keywords. Nothing is charged
            until you confirm the cost.
          </p>
        </div>

        {loadError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {loadError}
          </div>
        )}

        <BriefStep number={1} title="What do you want to write?">
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
        </BriefStep>

        <BriefStep number={2} title="Which keywords?" scrollIntoViewOnMount={initialKeywordIds !== undefined && initialKeywordIds.length > 0}>
          <BriefKeywordFields
            pickableKeywords={pickableKeywords}
            groups={groups}
            scope={scope}
            selectedKeywords={selectedKeywords}
            disabled={generating}
            issue={scopeIssue}
            onChange={changeScope}
          />
        </BriefStep>

        <BriefStep number={3} title="Review and start">
          <BriefReviewFields
            strategy={strategy}
            selectedKeywordCount={selectedKeywords.length}
            outputLanguage={outputLanguage}
            summary={summary}
            disabled={generating}
            submitDisabled={requestDisabled}
            strategyIssue={strategyIssue}
            onStrategyChange={(nextStrategy) => {
              setStrategy(nextStrategy);
              setValidationIssues([]);
            }}
            onLanguageChange={setOutputLanguage}
          />
        </BriefStep>
      </form>

      <GenerationConfirmation
        pending={pendingGeneration}
        generating={generating}
        onClose={() => setPendingGeneration(null)}
        onConfirm={confirmGeneration}
        summary={summary}
      />
    </>
  );
}
