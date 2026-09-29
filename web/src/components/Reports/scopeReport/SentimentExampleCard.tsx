import { useState } from 'react';
import type { SentimentExample } from '../../../types/domain/sentimentExamples';
import { formatDateOnly } from '../../../formatting/dateFormatter';
import {
  Button, ChevronDownIcon
} from '../../ui';
import { formatResponse } from '../../ui/MarkdownProcessor';
import { engineName } from '../charts';
import { SENTIMENT_TONES } from './sentimentTone';

interface Props {readonly example: SentimentExample;}

interface FullAnswerProps {
  readonly answer: string;
  readonly truncated: boolean;
}

function FullAnswer({
  answer, truncated
}: FullAnswerProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        // Stryker disable next-line StringLiteral: Tailwind-only chevron sizing and rotation; aria-expanded carries the state
        leadingIcon={<ChevronDownIcon className={open ? 'w-4 h-4 rotate-180' : 'w-4 h-4'} />}
        className="-ml-3"
      >
        {open ? 'Hide full answer' : 'Show full answer'}
      </Button>
      {open && (
        <div className="prose-markdown mt-2 max-h-96 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 p-4 text-sm">
          {formatResponse(answer)}
          {truncated && <p className="text-xs text-gray-500 dark:text-gray-400">The answer is cut at 20,000 characters.</p>}
        </div>
      )}
    </div>
  );
}

/**
 * One answer behind a sentiment count: the brand and where the answer comes
 * from, the passage carrying the sentiment verbatim, why it was labelled so,
 * and the full answer on demand.
 */
export function SentimentExampleCard({ example }: Props) {
  const tone = SENTIMENT_TONES[example.sentiment];
  return (
    <li className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-gray-900 dark:text-white">{example.brand}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone.pill}`}>{tone.label}</span>
        {example.rank !== null && <span className="text-xs text-gray-500 dark:text-gray-400">{`Rank ${example.rank}`}</span>}
      </div>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {[
          `Keyword: ${example.keyword}`,
          `Engine: ${engineName(example.provider)}`,
          `Persona: ${example.persona_name ?? example.persona}`,
          `Run: ${formatDateOnly(example.timestamp)}`,
        ].join(' · ')}
      </p>
      {example.quote && (
        <blockquote className={`mt-3 border-l-4 pl-3 text-sm text-gray-800 dark:text-gray-200 ${tone.quote}`}>{example.quote}</blockquote>
      )}
      {example.reason && <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">{`Why: ${example.reason}`}</p>}
      {example.ranking_context && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{`Ranking context: ${example.ranking_context}`}</p>
      )}
      <FullAnswer answer={example.answer} truncated={example.answer_truncated} />
    </li>
  );
}
