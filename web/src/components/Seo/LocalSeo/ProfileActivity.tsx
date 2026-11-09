/**
 * Reviews, profile updates (posts) and questions & answers of one business.
 *
 * Reviews and updates are queued DataForSEO tasks: one paid start per click, then free polling until the
 * results arrive (usually under a minute). Asking again within the hour collects the same tasks for free.
 * Q&A is one live call; Google keeps Q&A for few businesses, so an empty answer is stated as such.
 */
import {
  useState, type ReactNode
} from 'react';
import { fetchBusinessQuestions } from '../../../api/seoLocal';
import { useSeoRequest } from '../../../hooks/useKeywordExplorerRequest';
import {
  useLocalSeoJob, type LocalJobController, type LocalJobState
} from '../../../hooks/useLocalSeoJob';
import type {
  BusinessIdentity, LocalPoint, ReviewsResult, StarCounts, UpdatesResult
} from '../../../types/api/seoLocal';
import { Button } from '../../ui/Button';
import { ErrorAlert } from '../../ui/ErrorAlert';
import { SkeletonLines } from '../../ui/Skeleton';
import { SelectField } from './LocalSeoFields';
import { LocalCard } from './LocalSeoLayout';

interface ActivityProps {
  readonly identity: BusinessIdentity;
  readonly point: LocalPoint;
}

const DEPTHS = ['20', '50', '100'].map((depth) => ({
  value: depth,
  label: `${depth} reviews` 
}));
const STARS = ['5', '4', '3', '2', '1'] as const;

export function JobProgress({ state }: { readonly state: LocalJobState }) {
  if (state.status === 'starting') return <SkeletonLines lines={2} />;
  if (state.status === 'error') return <ErrorAlert message={state.message} />;
  if (state.status !== 'running' && state.status !== 'done') return null;
  const { job } = state;
  if (job.status === 'failed') return <ErrorAlert message={job.error ?? 'The job failed'} />;
  if (job.status === 'timed_out') {
    return <p className="text-sm text-amber-700">DataForSEO is still working on it. Ask again to collect the results.</p>;
  }
  if (job.status === 'completed') return null;
  return (
    <output className="block text-sm text-gray-600">
      Waiting for DataForSEO… {job.progress.ready} of {job.progress.total} ready
      {state.reused ? ' (already paid for)' : ''}
    </output>
  );
}

function Histogram({ counts }: { readonly counts: StarCounts }) {
  const total = STARS.reduce((sum, star) => sum + counts[star], 0);
  return (
    <ul className="space-y-1" aria-label="Rating histogram">
      {STARS.map((star) => {
        const share = total === 0 ? 0 : Math.round((counts[star] / total) * 100);
        return (
          <li key={star} className="flex items-center gap-2 text-xs text-gray-600">
            <span className="w-6">{star}★</span>
            <span className="h-2 flex-1 rounded bg-gray-100">
              <span className="block h-2 rounded bg-amber-400" style={{ width: `${share}%` }} />
            </span>
            <span className="w-10 text-right">{counts[star]}</span>
          </li>
        );
      })}
    </ul>
  );
}

function ReviewsSummary({ result }: { readonly result: ReviewsResult }) {
  const rate = result.summary.owner_response_rate;
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-700">
        {result.reviews.length} latest reviews · owner replied to {rate === null ? '–' : `${Math.round(rate * 100)}%`}
      </p>
      <Histogram counts={result.summary.histogram} />
      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
        {result.reviews.slice(0, 10).map((review, position) => (
          <li key={review.review_id ?? `${review.timestamp ?? ''}-${String(position)}`} className="py-2 text-sm">
            <p className="font-medium text-gray-900">{review.rating ?? '–'}★ {review.profile_name ?? 'Anonymous'} · {review.time_ago ?? ''}</p>
            <p className="text-gray-700">{review.review_text ?? ''}</p>
            {review.owner_answer && <p className="mt-1 border-l-2 border-gray-200 pl-2 text-gray-600">Owner: {review.owner_answer}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function UpdatesList({ result }: { readonly result: UpdatesResult }) {
  if (result.updates.length === 0) return <p className="text-sm text-gray-600">This business has published no updates.</p>;
  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-700">
      {result.updates.map((update, position) => (
        <li key={update.url ?? `${update.timestamp ?? ''}-${String(position)}`} className="py-2 text-sm">
          <p className="text-xs text-gray-500">{update.post_date ?? update.timestamp ?? ''}</p>
          <p className="text-gray-700">{update.post_text ?? ''}</p>
        </li>
      ))}
    </ul>
  );
}

interface JobPanelProps {
  readonly title: string;
  readonly buttonLabel: string;
  readonly job: LocalJobController;
  readonly onStart: () => void;
  readonly children?: ReactNode;
}

/** A queued job's card: its options, the start button (disabled while it runs), its progress and results. */
function JobPanel({
  title, buttonLabel, job, onStart, children
}: JobPanelProps) {
  const running = job.state.status === 'starting' || job.state.status === 'running';
  return (
    <LocalCard title={title}>
      <div className="flex flex-wrap items-end gap-3">
        {children}
        <Button variant="secondary" disabled={running} onClick={onStart}>{buttonLabel}</Button>
      </div>
      <JobProgress state={job.state} />
    </LocalCard>
  );
}

function ReviewsPanel({
  identity, point
}: ActivityProps) {
  const job = useLocalSeoJob();
  const [depth, setDepth] = useState('20');
  const { state } = job;
  const done = state.status === 'done' && state.job.kind === 'reviews' ? state.job.result : null;
  return (
    <div className="space-y-3">
      <JobPanel
        title="Reviews"
        buttonLabel="Fetch reviews"
        job={job}
        onStart={() => { void job.start({
          kind: 'reviews',
          ...identity,
          ...point,
          depth: Number(depth) 
        }); }}
      >
        <SelectField label="Latest reviews" value={depth} options={DEPTHS} onChange={setDepth} />
      </JobPanel>
      {done && <ReviewsSummary result={done} />}
    </div>
  );
}

function UpdatesPanel({
  identity, point
}: ActivityProps) {
  const job = useLocalSeoJob();
  const { state } = job;
  const done = state.status === 'done' && state.job.kind === 'updates' ? state.job.result : null;
  return (
    <div className="space-y-3">
      <JobPanel
        title="Updates and posts"
        buttonLabel="Fetch updates"
        job={job}
        onStart={() => { void job.start({
          kind: 'updates',
          ...identity,
          ...point,
          depth: 10 
        }); }}
      />
      {done && <UpdatesList result={done} />}
    </div>
  );
}

function QuestionsPanel({
  identity, point
}: ActivityProps) {
  const request = useSeoRequest(fetchBusinessQuestions);
  const { state } = request;
  return (
    <LocalCard title="Questions and answers">
      <Button
        variant="secondary"
        disabled={state.status === 'loading'}
        onClick={() => { void request.run({
          ...identity,
          ...point 
        }); }}
      >
        Fetch Q&amp;A
      </Button>
      {state.status === 'loading' && <SkeletonLines lines={3} />}
      {state.status === 'error' && <ErrorAlert message={state.message} />}
      {state.status === 'success' && state.response.questions.length === 0 && (
        <p className="text-sm text-gray-600">Google returned no questions and answers for this business.</p>
      )}
      {state.status === 'success' && state.response.questions.length > 0 && (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {state.response.questions.map((question, position) => (
            <li key={question.question_id ?? String(position)} className="py-2 text-sm">
              <p className="font-medium text-gray-900">{question.question_text}</p>
              <p className="text-gray-600">{question.answers[0]?.answer_text ?? 'No answer yet'}</p>
            </li>
          ))}
        </ul>
      )}
    </LocalCard>
  );
}

/** The three activity panels of one business; each pays only when its button is clicked. */
export function ProfileActivity(props: ActivityProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <ReviewsPanel {...props} />
      <UpdatesPanel {...props} />
      <QuestionsPanel {...props} />
    </div>
  );
}
