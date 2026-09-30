import type {
  Execution, ExecutionEvent 
} from '../types';
import type { KeywordProgress } from './executionProcessor';

const EVENT_DEFAULTS: ExecutionEvent = {
  id: 'event-1',
  timestamp: '2026-01-23T10:00:00Z',
  type: 'TaskStarted',
  state_name: 'ParseKeywords',
};

const createEventIdGenerator = () => {
  const state = { counter: 0 };
  return () => {
    state.counter += 1;
    return `event-${state.counter}`;
  };
};

const generateEventId = createEventIdGenerator();

export function buildEvent(overrides: Partial<ExecutionEvent> = {}): ExecutionEvent {
  return {
    ...EVENT_DEFAULTS,
    ...overrides,
    id: overrides.id ?? generateEventId() 
  };
}

export function buildExecution(overrides: Partial<Execution> = {}): Execution {
  return {
    arn: 'arn:aws:states:us-east-1:123:execution:test',
    name: 'test-execution',
    status: 'RUNNING',
    start_date: '2026-01-23T10:00:00Z',
    events: [],
    ...overrides,
  };
}

export function buildCompletedExecution(): Execution {
  return buildExecution({
    status: 'SUCCEEDED',
    stop_date: '2026-01-23T10:05:00Z',
    events: [
      buildEvent({
        type: 'TaskStarted',
        state_name: 'ParseKeywords',
        timestamp: '2026-01-23T10:00:00Z' 
      }),
      buildEvent({
        type: 'TaskSucceeded',
        state_name: 'ParseKeywords',
        timestamp: '2026-01-23T10:01:00Z' 
      }),
      buildEvent({
        type: 'TaskStarted',
        state_name: 'SearchAllProviders',
        timestamp: '2026-01-23T10:01:00Z' 
      }),
      buildEvent({
        type: 'TaskSucceeded',
        state_name: 'SearchAllProviders',
        timestamp: '2026-01-23T10:02:00Z' 
      }),
      buildEvent({
        type: 'TaskStarted',
        state_name: 'Deduplication',
        timestamp: '2026-01-23T10:02:00Z' 
      }),
      buildEvent({
        type: 'TaskSucceeded',
        state_name: 'Deduplication',
        timestamp: '2026-01-23T10:03:00Z' 
      }),
      buildEvent({
        type: 'TaskStarted',
        state_name: 'Crawl',
        timestamp: '2026-01-23T10:03:00Z' 
      }),
      buildEvent({
        type: 'TaskSucceeded',
        state_name: 'Crawl',
        timestamp: '2026-01-23T10:04:00Z' 
      }),
      buildEvent({
        type: 'TaskStarted',
        state_name: 'GenerateSummary',
        timestamp: '2026-01-23T10:04:00Z' 
      }),
      buildEvent({
        type: 'TaskSucceeded',
        state_name: 'GenerateSummary',
        timestamp: '2026-01-23T10:05:00Z' 
      }),
    ],
  });
}

export function buildKeywordProgress(overrides: Partial<KeywordProgress> = {}): KeywordProgress {
  return {
    keywords_total: 20,
    keywords_succeeded: 9,
    keywords_failed: 1,
    keywords_running: 4,
    keywords_pending: 6,
    ...overrides,
  };
}

/**
 * The parent-history events of a Distributed Map run, in the order they
 * happen. `MapRunFailed` stands in for `MapRunSucceeded` + `MapStateExited`
 * when a run fails; pick the ones a scenario needs.
 */
const DISTRIBUTED_MAP_EVENTS = {
  parseStarted: {
    type: 'TaskStarted',
    state_name: 'ParseKeywords' 
  },
  parseSucceeded: {
    type: 'TaskSucceeded',
    state_name: 'ParseKeywords' 
  },
  mapStateStarted: {
    type: 'MapStateStarted',
    state_name: 'ProcessKeywords' 
  },
  mapRunStarted: {
    type: 'MapRunStarted',
    state_name: 'ProcessKeywords' 
  },
  mapRunFailed: {
    type: 'MapRunFailed',
    state_name: 'ProcessKeywords',
    error: 'States.ExceedToleratedFailureThreshold' 
  },
  mapRunSucceeded: {
    type: 'MapRunSucceeded',
    state_name: 'ProcessKeywords' 
  },
  mapStateExited: {
    type: 'MapStateExited',
    state_name: 'ProcessKeywords' 
  },
  summaryStarted: {
    type: 'TaskStarted',
    state_name: 'GenerateSummary' 
  },
  summarySucceeded: {
    type: 'TaskSucceeded',
    state_name: 'GenerateSummary' 
  },
} satisfies Record<string, Partial<ExecutionEvent>>;

export type DistributedMapEvent = keyof typeof DISTRIBUTED_MAP_EVENTS;

const DISTRIBUTED_MAP_ORDER = Object.keys(DISTRIBUTED_MAP_EVENTS);

/** A running execution whose history holds `names`, each timestamped by its place in the workflow. */
export function buildDistributedMapExecution(
  names: DistributedMapEvent[],
  overrides: Partial<Execution> = {}
): Execution {
  return buildExecution({
    events: names.map(name => buildEvent({
      ...DISTRIBUTED_MAP_EVENTS[name],
      timestamp: `2026-01-23T10:${String(DISTRIBUTED_MAP_ORDER.indexOf(name)).padStart(2, '0')}:00Z`,
    })),
    ...overrides,
  });
}

/** A running execution started before the Distributed Map: its history names the per-keyword states. */
export function buildLegacyExecution(events: Partial<ExecutionEvent>[]): Execution {
  return buildExecution({
    events: [
      buildEvent({
        type: 'TaskSucceeded',
        state_name: 'ParseKeywords',
        timestamp: '2026-01-23T10:00:00Z' 
      }),
      ...events.map((event, index) => buildEvent({
        timestamp: `2026-01-23T10:0${index + 1}:00Z`,
        ...event,
      })),
    ],
  });
}
