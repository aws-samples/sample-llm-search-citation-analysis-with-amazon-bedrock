import type {
  Execution, ExecutionEvent
} from '../../types';
import {
  formatDate, formatTime
} from '../../formatting/dateFormatter';
import { Disclosure } from '../ui/Disclosure';
import { plural } from './runTargets';

const STARTED_MESSAGES: Readonly<Record<string, string>> = {
  ParseKeywords: 'Preparing the keywords',
  SearchAllProviders: 'Asking the AI engines',
  Deduplication: 'Removing duplicate citations',
  Crawl: 'Crawling the cited pages',
  GenerateSummary: 'Writing the summary',
};
const STARTED_TYPES = new Set(['TaskStarted', 'TaskScheduled', 'TaskStateEntered']);
const SUCCEEDED_TYPES = new Set(['TaskSucceeded', 'TaskStateExited']);
const SUCCEEDED_MESSAGES: Readonly<Record<string, string>> = {
  ParseKeywords: 'Keywords ready',
  SearchAllProviders: 'AI engines answered',
  Deduplication: 'Duplicate citations removed',
  Crawl: 'Cited pages crawled',
  GenerateSummary: 'Summary written',
};

function messageFor(messages: Readonly<Record<string, string>>, stateName: string): string | undefined {
  return Object.entries(messages).find(([key]) => stateName.includes(key))?.[1];
}

/** The friendly line of a task start or success, by its state. */
function knownTaskMessage(event: ExecutionEvent): string | undefined {
  const stateName = event.state_name ?? '';
  if (STARTED_TYPES.has(event.type)) return messageFor(STARTED_MESSAGES, stateName);
  if (SUCCEEDED_TYPES.has(event.type)) return messageFor(SUCCEEDED_MESSAGES, stateName);
  return undefined;
}

/** The event's line: a known task start or success, else the API's message, else its type. */
function formatEventMessage(event: ExecutionEvent): string {
  return knownTaskMessage(event) ?? event.message ?? event.type;
}

const LogItem = ({ event }: { readonly event: ExecutionEvent }) => (
  <li className="flex gap-4 py-2 text-sm">
    <span className="w-20 shrink-0 text-xs text-gray-500 tabular-nums pt-0.5">{formatTime(event.timestamp)}</span>
    <div className="min-w-0 flex-1">
      <p className="text-gray-900 break-words">{formatEventMessage(event)}</p>
      {event.details && <p className="text-gray-600 break-words">{event.details}</p>}
      {event.error && <p className="text-red-700 font-mono text-xs break-words">{event.error}</p>}
    </div>
  </li>
);

const ActivityLog = ({
  events, isRunning
}: {
  readonly events: ExecutionEvent[];
  readonly isRunning: boolean 
}) => {
  if (events.length === 0) {
    return <p className="text-sm text-gray-500">{isRunning ? 'Waiting for the first events…' : 'No events recorded.'}</p>;
  }
  return (
    <ol aria-label="Activity log" className="max-h-80 overflow-y-auto divide-y divide-gray-100 border-y border-gray-100">
      {events.map((event) => <LogItem key={event.id ?? event.timestamp} event={event} />)}
    </ol>
  );
};

const DetailRow = ({
  label, value
}: {
  readonly label: string;
  readonly value: string 
}) => (
  <div className="min-w-0">
    <dt className="text-xs text-gray-500">{label}</dt>
    <dd className="text-sm text-gray-900 break-all">{value}</dd>
  </div>
);

interface RunDetailsProps {
  readonly execution: Execution;
  readonly events: ExecutionEvent[];
  readonly isRunning: boolean;
}

/**
 * Reference material behind a disclosure: the run's id and status code, its
 * timestamps and the activity log (newest first).
 */
export const RunDetails = ({
  execution, events, isRunning
}: RunDetailsProps) => (
  <Disclosure
    title={events.length > 0 ? `Details and activity log (${plural(events.length, 'event')})` : 'Details and activity log'}
    headingLevel={3}
    headingClassName="text-sm font-medium text-gray-700"
  >
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4">
      <DetailRow label="Run id" value={execution.name || 'Unnamed'} />
      <DetailRow label="Status code" value={execution.status} />
      <DetailRow label="Started" value={formatDate(execution.start_date)} />
      {execution.stop_date && <DetailRow label="Ended" value={formatDate(execution.stop_date)} />}
    </dl>
    <ActivityLog events={events} isRunning={isRunning} />
  </Disclosure>
);
