import {
  useId, useMemo, useState
} from 'react';
import type {
  AgentDimensionOption, KeywordGroup, ResearchTemplate
} from '../../../types';
import type {
  StartAgentRequest, TemplateChanges, TemplateDraft
} from '../../../api/keywordResearch';
import type { TemplateMutationOutcome } from '../../../hooks/useResearchTemplates';
import { Spinner } from '../../ui/Spinner';
import {
  BRIEF_INPUT_CLASS, MarketSelect, TemplatePicker
} from './AgentBriefFields';
import { AgentTemplateEditor } from './AgentTemplateEditor';
import {
  AGENT_DEFAULT_ROUNDS,
  AGENT_DEFAULT_TARGET_COUNT,
  AGENT_DEFAULT_TRACKING_COUNT,
  AGENT_INSTRUCTION_MAX_LENGTH,
  AGENT_MAX_ROUNDS,
  AGENT_MAX_TARGET_COUNT,
  AGENT_MAX_TRACKING_COUNT,
  AGENT_MIN_TARGET_COUNT,
  AGENT_MIN_TRACKING_COUNT,
  BUILTIN_TEMPLATE_ID,
  COUNTRY_OPTIONS,
  LANGUAGE_OPTIONS,
  briefProblems,
  estimateAgentCost,
  formatAgentCost,
  seedPlaceholder,
  subjectHeading,
  subjectLabel,
} from './agentBrief';

interface AgentBriefFormProps {
  readonly groups: KeywordGroup[];
  readonly templates: ResearchTemplate[];
  readonly templatesLoading: boolean;
  readonly starting: boolean;
  readonly onStart: (request: StartAgentRequest) => Promise<unknown>;
  readonly onSaveTemplate: (draft: TemplateDraft) => Promise<TemplateMutationOutcome>;
  readonly onUpdateTemplate: (id: string, changes: TemplateChanges) => Promise<TemplateMutationOutcome>;
  readonly onDeleteTemplate: (id: string) => Promise<TemplateMutationOutcome>;
}

/** Copy while the templates are still loading; every template replaces it with its own subject. */
const LOADING_SUBJECT = 'business';

/** What the brief shows for the selected template: its catalogue, the ticked dimensions and the prompt the run would use. */
interface SelectedTemplateBrief {
  readonly catalog: readonly AgentDimensionOption[];
  readonly catalogIds: string[];
  readonly selectedDimensions: string[];
  readonly promptText: string;
  readonly promptDirty: boolean;
  readonly subject: string;
}

/**
 * Resolves the template-driven part of the brief. `dimensions` null means every
 * catalogue dimension; `systemPrompt` null means the template's own prompt. The
 * template is undefined while the list loads (or after the selected one was deleted).
 */
function selectedTemplateBrief(
  template: ResearchTemplate | undefined,
  dimensions: string[] | null,
  systemPrompt: string | null
): SelectedTemplateBrief {
  const catalog = template?.dimensions ?? [];
  const catalogIds = catalog.map((option) => option.id);
  const promptText = systemPrompt ?? template?.system_prompt ?? '';
  return {
    catalog,
    catalogIds,
    selectedDimensions: dimensions ?? catalogIds,
    promptText,
    promptDirty: template !== undefined && promptText !== template.system_prompt,
    subject: template?.subject ?? LOADING_SUBJECT,
  };
}

/**
 * The brief the agent researches, driven by an industry template: the
 * business (seed), market, the template's expansion dimensions, a free-text
 * instruction, the target size and round budget, the destination group and —
 * behind a disclosure — the template editor. Shows the cost ceiling before
 * the run starts.
 */
export function AgentBriefForm({
  groups, templates, templatesLoading, starting, onStart, onSaveTemplate, onUpdateTemplate, onDeleteTemplate
}: AgentBriefFormProps) {
  const ids = {
    template: useId(),
    seed: useId(),
    country: useId(),
    language: useId(),
    instruction: useId(),
    target: useId(),
    tracking: useId(),
    rounds: useId(),
    group: useId(),
  };
  const [templateId, setTemplateId] = useState(BUILTIN_TEMPLATE_ID);
  const [seed, setSeed] = useState('');
  const [country, setCountry] = useState('es');
  const [language, setLanguage] = useState('es');
  // null = all of the template's dimensions (the default after every template switch).
  const [dimensions, setDimensions] = useState<string[] | null>(null);
  const [instruction, setInstruction] = useState('');
  const [targetCount, setTargetCount] = useState(AGENT_DEFAULT_TARGET_COUNT);
  const [trackingCountText, setTrackingCountText] = useState(String(AGENT_DEFAULT_TRACKING_COUNT));
  const trackingCount = Number(trackingCountText);
  const [maxRounds, setMaxRounds] = useState(AGENT_DEFAULT_ROUNDS);
  const [groupId, setGroupId] = useState('');
  // null = the template's own prompt; a string once the user edits it in this session.
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [notice, setNotice] = useState<TemplateMutationOutcome | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const template = templates.find((item) => item.id === templateId);
  const {
    catalog, catalogIds, selectedDimensions, promptText, promptDirty, subject
  } = selectedTemplateBrief(template, dimensions, systemPrompt);

  const problems = briefProblems({
    seed,
    subject,
    dimensions: selectedDimensions,
    country,
    language,
    targetCount,
    trackingCount,
    systemPrompt: promptText,
  });
  const cost = useMemo(() => estimateAgentCost(maxRounds), [maxRounds]);
  const sortedGroups = useMemo(
    () => [...groups].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })),
    [groups]
  );

  /** Switch template: all its dimensions checked, its prompt unless the user edited theirs. */
  const selectTemplate = (id: string) => {
    setTemplateId(id);
    setDimensions(null);
    if (!promptDirty) setSystemPrompt(null);
  };

  const toggleDimension = (id: string) => {
    setDimensions(selectedDimensions.includes(id) ? selectedDimensions.filter((item) => item !== id) : [...selectedDimensions, id]);
  };

  const updateTargetCount = (value: string) => {
    const resolved = Math.min(
      AGENT_MAX_TARGET_COUNT,
      Math.max(AGENT_MIN_TARGET_COUNT, Number(value) || AGENT_MIN_TARGET_COUNT)
    );
    setTargetCount(resolved);
    setTrackingCountText((current) => {
      if (current === '') return current;
      return String(Math.min(Number(current), resolved));
    });
  };

  const updateTrackingCount = (value: string) => {
    if (value === '') {
      setTrackingCountText('');
      return;
    }
    const parsedTrackingCount = Number(value);
    const numericTrackingCount = Number.isFinite(parsedTrackingCount)
      ? Math.trunc(parsedTrackingCount)
      : AGENT_MIN_TRACKING_COUNT;
    const resolvedTrackingCount = Math.min(
      AGENT_MAX_TRACKING_COUNT,
      targetCount,
      Math.max(AGENT_MIN_TRACKING_COUNT, numericTrackingCount)
    );
    setTrackingCountText(String(resolvedTrackingCount));
  };

  const recordOutcome = async (mutation: Promise<TemplateMutationOutcome>) => {
    setNotice(null);
    const outcome = await mutation;
    setNotice(outcome);
    return outcome;
  };

  const handleSaveAsNew = async (draft: TemplateDraft) => {
    const outcome = await recordOutcome(onSaveTemplate(draft));
    if (outcome.template) {
      setTemplateId(outcome.template.id);
      setDimensions(null);
      setSystemPrompt(null);
    }
    return outcome;
  };

  const handleUpdate = async (changes: TemplateChanges) => {
    const outcome = await recordOutcome(onUpdateTemplate(templateId, changes));
    if (outcome.template) {
      setDimensions(null);
      setSystemPrompt(null);
    }
    return outcome;
  };

  const handleDelete = async () => {
    const outcome = await recordOutcome(onDeleteTemplate(templateId));
    if (outcome.success) {
      setTemplateId(BUILTIN_TEMPLATE_ID);
      setDimensions(null);
      setSystemPrompt(null);
    }
    return outcome;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (problems.length > 0) return;
    await onStart({
      seed: seed.trim(),
      country: country.trim().toLowerCase(),
      language: language.trim().toLowerCase(),
      dimensions: catalogIds.filter((id) => selectedDimensions.includes(id)),
      instruction: instruction.trim(),
      targetCount,
      trackingCount,
      maxRounds,
      templateId,
      systemPrompt: promptDirty ? promptText : null,
      groupId: groupId === '' ? null : groupId,
    });
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="bg-white rounded-lg border border-gray-200 p-6 space-y-5" aria-label="Research agent brief">
      <div>
        <h3 className="text-sm font-medium text-gray-900">{subjectHeading(subject)}</h3>
        <p className="text-xs text-gray-500 mt-1">
          The agent plans its own searches from this brief, runs them, judges the results and proposes the keywords the {subject} should be visible for.
        </p>
      </div>

      <TemplatePicker
        id={ids.template}
        templates={templates}
        loading={templatesLoading}
        value={templateId}
        description={template?.description}
        promptDirty={promptDirty}
        onChange={selectTemplate}
        onResetPrompt={() => setSystemPrompt(null)}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-1">
          <label htmlFor={ids.seed} className="block text-sm text-gray-600 mb-1">{subjectLabel(subject)} (or seed)</label>
          <input id={ids.seed} type="text" value={seed} maxLength={200} onChange={(event) => setSeed(event.target.value)} placeholder={seedPlaceholder(subject)} className={BRIEF_INPUT_CLASS} />
        </div>
        <MarketSelect id={ids.country} name="country" label="Market (country)" value={country} options={COUNTRY_OPTIONS} onChange={setCountry} />
        <MarketSelect id={ids.language} name="language" label="Language" value={language} options={LANGUAGE_OPTIONS} onChange={setLanguage} />
      </div>

      <fieldset>
        <legend className="block text-sm text-gray-600 mb-2">Expand by</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {catalog.map((option) => {
            const checked = selectedDimensions.includes(option.id);
            const checkboxId = `research-agent-dimension-${option.id}`;
            return (
              <label
                key={option.id}
                htmlFor={checkboxId}
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${checked ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-300'}`}
              >
                <input id={checkboxId} name="dimensions" value={option.id} type="checkbox" checked={checked} onChange={() => toggleDimension(option.id)} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-500" />
                <span>
                  <span className="block text-sm font-medium text-gray-900">{option.label}</span>
                  <span className="block text-xs text-gray-500">{option.description}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label htmlFor={ids.instruction} className="block text-sm text-gray-600 mb-1">Extra instruction (optional)</label>
        <textarea
          id={ids.instruction}
          value={instruction}
          maxLength={AGENT_INSTRUCTION_MAX_LENGTH}
          onChange={(event) => setInstruction(event.target.value)}
          rows={2}
          placeholder="e.g. also expand by events and seasons; skip branded terms"
          className={BRIEF_INPUT_CLASS}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label htmlFor={ids.target} className="block text-sm text-gray-600 mb-1">Target keywords</label>
          <input
            id={ids.target}
            type="number"
            min={AGENT_MIN_TARGET_COUNT}
            max={AGENT_MAX_TARGET_COUNT}
            step={10}
            value={targetCount}
            onChange={(event) => updateTargetCount(event.target.value)}
            className={BRIEF_INPUT_CLASS}
          />
        </div>
        <div>
          <label htmlFor={ids.tracking} className="block text-sm text-gray-600 mb-1">Tracking keywords</label>
          <input
            id={ids.tracking}
            type="number"
            min={AGENT_MIN_TRACKING_COUNT}
            max={Math.min(AGENT_MAX_TRACKING_COUNT, targetCount)}
            step={1}
            value={trackingCountText}
            onChange={(event) => updateTrackingCount(event.target.value)}
            className={BRIEF_INPUT_CLASS}
          />
          <p className="mt-1 text-xs text-gray-500">Recommended active shortlist. This is a demand proxy, not measured search volume.</p>
        </div>
        <div>
          <label htmlFor={ids.rounds} className="block text-sm text-gray-600 mb-1">Research rounds</label>
          <select id={ids.rounds} value={maxRounds} onChange={(event) => setMaxRounds(Number(event.target.value))} className={BRIEF_INPUT_CLASS}>
            {Array.from({ length: AGENT_MAX_ROUNDS }, (_, index) => index + 1).map((rounds) => (
              <option key={rounds} value={rounds}>{rounds === 1 ? '1 round (fastest)' : `up to ${rounds} rounds`}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={ids.group} className="block text-sm text-gray-600 mb-1">Add results to group</label>
          <select id={ids.group} value={groupId} onChange={(event) => setGroupId(event.target.value)} className={BRIEF_INPUT_CLASS}>
            <option value="">Choose later</option>
            {sortedGroups.map((group) => <option key={group.id} value={group.id}>{group.name} ({group.keyword_count})</option>)}
          </select>
        </div>
      </div>

      <details className="rounded-lg border border-gray-200 bg-gray-50">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-gray-900">Customise the instructions or create your own template</summary>
        <div className="px-4 pb-4 space-y-3">
          {template && (
            <AgentTemplateEditor
              key={template.id}
              template={template}
              systemPrompt={promptText}
              onPromptChange={setSystemPrompt}
              onSaveAsNew={handleSaveAsNew}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              disabled={starting}
            />
          )}
          {notice && (
            <output className={`block text-sm ${notice.success ? 'text-green-700' : 'text-red-700'}`}>{notice.message}</output>
          )}
        </div>
      </details>

      {submitted && problems.length > 0 && (
        <ul role="alert" className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 list-disc list-inside">
          {problems.map((problem) => <li key={problem}>{problem}</li>)}
        </ul>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
        <p className="text-xs text-gray-500">{formatAgentCost(cost)} Runs continue in the background; you can start several.</p>
        <button
          type="submit"
          disabled={starting}
          className="w-full sm:w-auto px-6 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {starting ? (
            <>
              <Spinner size="sm" />
              Starting…
            </>
          ) : 'Start research'}
        </button>
      </div>
    </form>
  );
}
