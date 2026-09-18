import {
  useEffect, useId, useMemo, useState
} from 'react';
import type {
  AgentDimension, KeywordGroup, ResearchTemplate
} from '../../../types';
import type { StartAgentRequest } from '../../../api/keywordResearch';
import type { TemplateMutationOutcome } from '../../../hooks/useResearchTemplates';
import { Spinner } from '../../ui/Spinner';
import { AgentPromptEditor } from './AgentPromptEditor';
import {
  AGENT_DEFAULT_ROUNDS,
  AGENT_DEFAULT_TARGET_COUNT,
  AGENT_INSTRUCTION_MAX_LENGTH,
  AGENT_MAX_ROUNDS,
  AGENT_MAX_TARGET_COUNT,
  AGENT_MIN_TARGET_COUNT,
  BUILTIN_TEMPLATE_ID,
  COUNTRY_OPTIONS,
  DEFAULT_DIMENSIONS,
  DIMENSION_OPTIONS,
  LANGUAGE_OPTIONS,
  briefProblems,
  estimateAgentCost,
  formatAgentCost,
} from './agentBrief';

interface AgentBriefFormProps {
  readonly groups: KeywordGroup[];
  readonly templates: ResearchTemplate[];
  readonly templatesLoading: boolean;
  readonly starting: boolean;
  readonly onStart: (request: StartAgentRequest) => Promise<unknown>;
  readonly onSaveTemplate: (name: string, systemPrompt: string) => Promise<TemplateMutationOutcome>;
  readonly onUpdateTemplate: (id: string, systemPrompt: string) => Promise<TemplateMutationOutcome>;
  readonly onDeleteTemplate: (id: string) => Promise<TemplateMutationOutcome>;
}

const INPUT_CLASS = 'w-full px-4 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-200 disabled:opacity-50';

function MarketSelect({
  id, label, value, options, onChange
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly options: readonly {
    code: string;
    label: string 
  }[];
  readonly onChange: (code: string) => void;
}) {
  const listed = options.some((option) => option.code === value);
  return (
    <div>
      <label htmlFor={id} className="block text-sm text-gray-600 mb-1">{label}</label>
      <select id={id} value={listed ? value : 'other'} onChange={(event) => onChange(event.target.value === 'other' ? '' : event.target.value)} className={INPUT_CLASS}>
        {options.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
        <option value="other">Other code…</option>
      </select>
      {!listed && (
        <input
          type="text"
          aria-label={`${label} code`}
          value={value}
          maxLength={2}
          onChange={(event) => onChange(event.target.value.toLowerCase())}
          placeholder="two-letter code"
          className={`${INPUT_CLASS} mt-2`}
        />
      )}
    </div>
  );
}

/**
 * The brief the agent researches: hotel, market, expansion dimensions, a
 * free-text instruction, the target size and round budget, the destination
 * group and the (editable) system prompt. Shows the cost ceiling before the
 * run starts.
 */
export function AgentBriefForm({
  groups, templates, templatesLoading, starting, onStart, onSaveTemplate, onUpdateTemplate, onDeleteTemplate
}: AgentBriefFormProps) {
  const ids = {
    seed: useId(),
    country: useId(),
    language: useId(),
    instruction: useId(),
    target: useId(),
    rounds: useId(),
    group: useId(),
  };
  const [seed, setSeed] = useState('');
  const [country, setCountry] = useState('es');
  const [language, setLanguage] = useState('es');
  const [dimensions, setDimensions] = useState<AgentDimension[]>([...DEFAULT_DIMENSIONS]);
  const [instruction, setInstruction] = useState('');
  const [targetCount, setTargetCount] = useState(AGENT_DEFAULT_TARGET_COUNT);
  const [maxRounds, setMaxRounds] = useState(AGENT_DEFAULT_ROUNDS);
  const [groupId, setGroupId] = useState('');
  const [templateId, setTemplateId] = useState(BUILTIN_TEMPLATE_ID);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [submitted, setSubmitted] = useState(false);

  // Load the built-in prompt once templates arrive; keep user edits after that.
  useEffect(() => {
    if (systemPrompt !== '' || templates.length === 0) return;
    const template = templates.find((item) => item.id === templateId) ?? templates[0];
    setTemplateId(template.id);
    setSystemPrompt(template.system_prompt);
  }, [templates, templateId, systemPrompt]);

  const problems = useMemo(() => briefProblems({
    seed,
    dimensions,
    country,
    language,
    systemPrompt,
  }), [seed, dimensions, country, language, systemPrompt]);
  const cost = useMemo(() => estimateAgentCost(maxRounds), [maxRounds]);
  const sortedGroups = useMemo(
    () => [...groups].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })),
    [groups]
  );
  const currentTemplate = templates.find((item) => item.id === templateId);
  const promptEdited = currentTemplate !== undefined && currentTemplate.system_prompt !== systemPrompt;

  const toggleDimension = (dimension: AgentDimension) => {
    setDimensions((prev) => (prev.includes(dimension) ? prev.filter((item) => item !== dimension) : [...prev, dimension]));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (problems.length > 0) return;
    await onStart({
      seed: seed.trim(),
      country: country.trim().toLowerCase(),
      language: language.trim().toLowerCase(),
      dimensions: DEFAULT_DIMENSIONS.filter((dimension) => dimensions.includes(dimension)),
      instruction: instruction.trim(),
      targetCount,
      maxRounds,
      templateId,
      systemPrompt: promptEdited ? systemPrompt : null,
      groupId: groupId === '' ? null : groupId,
    });
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="bg-white rounded-lg border border-gray-200 p-6 space-y-5" aria-label="Research agent brief">
      <div>
        <h3 className="text-sm font-medium text-gray-900">Research a hotel</h3>
        <p className="text-xs text-gray-500 mt-1">
          The agent plans its own searches from this brief, runs them, judges the results and proposes the keywords the hotel should be visible for.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-1">
          <label htmlFor={ids.seed} className="block text-sm text-gray-600 mb-1">Hotel (or seed)</label>
          <input id={ids.seed} type="text" value={seed} maxLength={200} onChange={(event) => setSeed(event.target.value)} placeholder="e.g. Hotel Gran Marino" className={INPUT_CLASS} />
        </div>
        <MarketSelect id={ids.country} label="Market (country)" value={country} options={COUNTRY_OPTIONS} onChange={setCountry} />
        <MarketSelect id={ids.language} label="Language" value={language} options={LANGUAGE_OPTIONS} onChange={setLanguage} />
      </div>

      <fieldset>
        <legend className="block text-sm text-gray-600 mb-2">Expand by</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {DIMENSION_OPTIONS.map((option) => {
            const checked = dimensions.includes(option.id);
            return (
              <label
                key={option.id}
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${checked ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-300'}`}
              >
                <input type="checkbox" checked={checked} onChange={() => toggleDimension(option.id)} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-500" />
                <span>
                  <span className="block text-sm font-medium text-gray-900">{option.label}</span>
                  <span className="block text-xs text-gray-500">{option.hint}</span>
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
          placeholder="e.g. also expand by events and seasons; the hotel is adults-only"
          className={INPUT_CLASS}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label htmlFor={ids.target} className="block text-sm text-gray-600 mb-1">Target keywords</label>
          <input
            id={ids.target}
            type="number"
            min={AGENT_MIN_TARGET_COUNT}
            max={AGENT_MAX_TARGET_COUNT}
            step={10}
            value={targetCount}
            onChange={(event) => setTargetCount(Math.min(AGENT_MAX_TARGET_COUNT, Math.max(AGENT_MIN_TARGET_COUNT, Number(event.target.value) || AGENT_MIN_TARGET_COUNT)))}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label htmlFor={ids.rounds} className="block text-sm text-gray-600 mb-1">Research rounds</label>
          <select id={ids.rounds} value={maxRounds} onChange={(event) => setMaxRounds(Number(event.target.value))} className={INPUT_CLASS}>
            {Array.from({ length: AGENT_MAX_ROUNDS }, (_, index) => index + 1).map((rounds) => (
              <option key={rounds} value={rounds}>{rounds === 1 ? '1 round (fastest)' : `up to ${rounds} rounds`}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={ids.group} className="block text-sm text-gray-600 mb-1">Add results to group</label>
          <select id={ids.group} value={groupId} onChange={(event) => setGroupId(event.target.value)} className={INPUT_CLASS}>
            <option value="">Choose later</option>
            {sortedGroups.map((group) => <option key={group.id} value={group.id}>{group.name} ({group.keyword_count})</option>)}
          </select>
        </div>
      </div>

      <AgentPromptEditor
        templates={templates}
        loading={templatesLoading}
        templateId={templateId}
        systemPrompt={systemPrompt}
        onTemplateChange={(template) => {
          setTemplateId(template.id);
          setSystemPrompt(template.system_prompt);
        }}
        onPromptChange={setSystemPrompt}
        onSaveAsNew={async (name) => {
          const outcome = await onSaveTemplate(name, systemPrompt);
          if (outcome.template) setTemplateId(outcome.template.id);
          return outcome;
        }}
        onUpdate={() => onUpdateTemplate(templateId, systemPrompt)}
        onDelete={async () => {
          const outcome = await onDeleteTemplate(templateId);
          if (outcome.success) {
            const fallback = templates.find((item) => item.builtin) ?? templates[0];
            setTemplateId(fallback.id);
            setSystemPrompt(fallback.system_prompt);
          }
          return outcome;
        }}
        disabled={starting}
      />

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
